import { z } from "zod";
import { isPermittedDatabaseUrl, isSameOriginRequest } from "./account-validation.ts";
import { HttpError, enforceRateLimit, readJson } from "./security.ts";

if (typeof window !== "undefined") throw new Error("Authentication must run on the server.");

export type AuthUser = { id: string; email: string; displayName: string; provider: "supabase" | "sites" };
export type AuthContext = { user: AuthUser | null; headers: Headers; accessToken?: string };
const ACCESS_COOKIE = "velora-access";
const REFRESH_COOKIE = "velora-refresh";
const sessionSchema = z.object({ access_token: z.string().min(1).max(3600), refresh_token: z.string().min(1).max(1000), expires_in: z.number().int().positive().max(86400) });
const userSchema = z.object({ id: z.string().uuid(), email: z.string().email(), user_metadata: z.record(z.unknown()).optional() });
const passwordSchema = z.string().min(12, "Use at least 12 characters.").max(128);
const credentialSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) }).strict();

export function authConfigured(): boolean {
  return Boolean((process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY) && process.env.SUPABASE_URL && isPermittedDatabaseUrl(process.env.SUPABASE_URL, process.env.ALLOW_LOCAL_SUPABASE === "true"));
}

export function privateHeaders(): Headers {
  return new Headers({ "Cache-Control": "private, no-store", Pragma: "no-cache", Vary: "Cookie, oai-authenticated-user-id", "Referrer-Policy": "no-referrer" });
}

function readCookie(request: Request, name: string): string | null {
  const parts = request.headers.get("cookie")?.split(";") ?? [];
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      try { const value = decodeURIComponent(part.slice(separator + 1).trim()); return value.length <= 4000 && /^[A-Za-z0-9._~-]+$/.test(value) ? value : null; } catch { return null; }
    }
  }
  return null;
}

function appendCookie(headers: Headers, request: Request, name: string, value: string, age: number) {
  const requestUrl = new URL(request.url);
  const local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(requestUrl.hostname);
  const secure = process.env.APP_URL?.startsWith("https://") || requestUrl.protocol === "https:" || !local;
  headers.append("Set-Cookie", `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`);
}

export function clearSession(headers: Headers, request: Request) {
  appendCookie(headers, request, ACCESS_COOKIE, "", 0);
  appendCookie(headers, request, REFRESH_COOKIE, "", 0);
}

function setSession(headers: Headers, request: Request, session: z.infer<typeof sessionSchema>) {
  appendCookie(headers, request, ACCESS_COOKIE, session.access_token, session.expires_in);
  appendCookie(headers, request, REFRESH_COOKIE, session.refresh_token, 30 * 24 * 60 * 60);
}

async function authRequest(path: string, options: RequestInit = {}, token?: string, administrative = false): Promise<unknown> {
  if (!authConfigured()) throw new HttpError("Account sign-in is not configured.", 503);
  const key = administrative ? process.env.SUPABASE_SERVICE_ROLE_KEY : (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY);
  if (!key) throw new HttpError("Account administration is not configured.", 503);
  const headers = new Headers(options.headers);
  headers.set("apikey", key);
  headers.set("Content-Type", "application/json");
  if (token || administrative) headers.set("Authorization", `Bearer ${token || key}`);
  let response: Response;
  try {
    response = await fetch(`${process.env.SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/${path}`, { ...options, headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
  } catch { throw new HttpError("The account service could not be reached. Try again shortly.", 503); }
  if (!response.ok) {
    if (response.status === 429) throw new HttpError("Too many sign-in attempts. Wait before trying again.", 429);
    if (response.status >= 500) throw new HttpError("The account service is temporarily unavailable.", 503);
    throw new HttpError("Account details or verification link could not be accepted.", response.status === 401 || response.status === 403 ? 401 : 400);
  }
  if (response.status === 204) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder(); let body = ""; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 100_000) { await reader.cancel(); throw new Error(); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body ? JSON.parse(body) : null;
  } catch { throw new HttpError("The account service returned an invalid response.", 503); }
  finally { reader.releaseLock(); }
}

async function verifiedUser(accessToken: string): Promise<AuthUser> {
  const parsed = userSchema.safeParse(await authRequest("user", {}, accessToken));
  if (!parsed.success) throw new HttpError("The account service returned an invalid user.", 503);
  const name = parsed.data.user_metadata?.display_name;
  return { id: `supabase:${parsed.data.id}`, email: parsed.data.email, displayName: typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : parsed.data.email, provider: "supabase" };
}

// Coalesces only concurrent refreshes; no token is retained after the request ends.
const refreshing = new Map<string, Promise<z.infer<typeof sessionSchema>>>();
async function refreshSession(refreshToken: string) {
  let pending = refreshing.get(refreshToken);
  if (!pending) {
    pending = authRequest("token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }).then((value) => {
      const result = sessionSchema.safeParse(value);
      if (!result.success) throw new HttpError("The account service returned an invalid session.", 503);
      return result.data;
    });
    if (refreshing.size < 100) refreshing.set(refreshToken, pending);
  }
  try { return await pending; } finally { refreshing.delete(refreshToken); }
}

export async function resolveUser(request: Request, { refresh = true } = {}): Promise<AuthContext> {
  const headers = privateHeaders();
  if (authConfigured()) {
    const access = readCookie(request, ACCESS_COOKIE);
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    if (access) {
      try { return { user: await verifiedUser(access), headers, accessToken: access }; }
      catch (error) { if (!(error instanceof HttpError) || (error.status !== 400 && error.status !== 401)) throw error; }
    }
    if (refresh && refreshToken) {
      try {
        const session = await refreshSession(refreshToken);
        const user = await verifiedUser(session.access_token);
        setSession(headers, request, session);
        return { user, headers, accessToken: session.access_token };
      } catch (error) { if (!(error instanceof HttpError) || (error.status !== 400 && error.status !== 401)) throw error; }
    }
    if (access || refreshToken) clearSession(headers, request);
  }
  if (process.env.TRUST_SITES_IDENTITY === "true") {
    const id = request.headers.get("oai-authenticated-user-id");
    const email = request.headers.get("oai-authenticated-user-email");
    if (id && email && id.length <= 150 && email.length <= 254) {
      let name = email;
      if (request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
        try { name = decodeURIComponent(request.headers.get("oai-authenticated-user-full-name") || email).slice(0, 80); } catch { /* Email fallback. */ }
      }
      return { user: { id, email, displayName: name, provider: "sites" }, headers };
    }
  }
  return { user: null, headers };
}

export function authResponse(value: unknown, context?: Pick<AuthContext, "headers">, status = 200) {
  return Response.json(value, { status, headers: context?.headers ?? privateHeaders() });
}

export function authFailure(error: unknown, headers = privateHeaders()) {
  return authResponse({ error: error instanceof HttpError ? error.message : "The account request could not be completed." }, { headers }, error instanceof HttpError ? error.status : 503);
}

export async function requireUser(request: Request): Promise<AuthContext & { user: AuthUser }> {
  const context = await resolveUser(request);
  if (!context.user) throw new HttpError("Sign in to access your account.", 401);
  return context as AuthContext & { user: AuthUser };
}

function redirectOrigin(): string {
  const value = process.env.APP_URL;
  if (!value || !isPermittedDatabaseUrl(value, process.env.ALLOW_LOCAL_SUPABASE === "true")) throw new HttpError("Account email redirects are not configured.", 503);
  return new URL(value).origin;
}

export async function handleAuth(request: Request, action: string): Promise<Response> {
  const headers = privateHeaders();
  try {
    if (action === "session") {
      enforceRateLimit(request, "auth-session", 90);
      const context = await resolveUser(request);
      return authResponse({ authAvailable: authConfigured(), sitesAvailable: process.env.TRUST_SITES_IDENTITY === "true", user: context.user }, context);
    }
    if (!isSameOriginRequest(request)) throw new HttpError("Same-origin account requests are required.", 403);
    enforceRateLimit(request, `auth-${action}`, action === "signin" ? 10 : 5);
    if (!authConfigured()) throw new HttpError("Account sign-in is not configured.", 503);
    const body = await readJson(request, 8192);
    if (action === "signout") {
      const context = await resolveUser(request);
      const access = context.accessToken;
      if (access) {
        try { await authRequest("logout?scope=local", { method: "POST" }, access); }
        catch (error) { if (!(error instanceof HttpError) || error.status >= 500) throw error; }
      }
      clearSession(headers, request);
      return authResponse({ signedOut: true }, { headers });
    }
    if (action === "recover") {
      const parsed = z.object({ email: z.string().trim().email().max(254) }).strict().safeParse(body);
      if (!parsed.success) throw new HttpError("Enter a valid email address.");
      await authRequest(`recover?redirect_to=${encodeURIComponent(`${redirectOrigin()}/auth/confirm`)}`, { method: "POST", body: JSON.stringify(parsed.data) });
      return authResponse({ accepted: true, message: "If this address has an account, a recovery email will arrive shortly." }, { headers });
    }
    if (action === "password") {
      const parsed = z.object({ password: passwordSchema }).strict().safeParse(body);
      if (!parsed.success) throw new HttpError("Use a password between 12 and 128 characters.");
      const context = await requireUser(request);
      if (context.user.provider !== "supabase" || !context.accessToken) throw new HttpError("Manage this identity's password with its sign-in provider.", 400);
      await authRequest("user", { method: "PUT", body: JSON.stringify(parsed.data) }, context.accessToken);
      return authResponse({ updated: true }, context);
    }
    let sessionValue: unknown;
    if (action === "verify") {
      const parsed = z.object({ tokenHash: z.string().min(20).max(1000), type: z.enum(["signup", "recovery", "email"]) }).strict().safeParse(body);
      if (!parsed.success) throw new HttpError("This verification link is invalid.");
      sessionValue = await authRequest("verify", { method: "POST", body: JSON.stringify({ token_hash: parsed.data.tokenHash, type: parsed.data.type === "email" ? "signup" : parsed.data.type }) });
    } else if (action === "signup") {
      const parsed = z.object({ email: z.string().trim().email().max(254), password: passwordSchema, displayName: z.string().trim().min(1).max(80).optional() }).strict().safeParse(body);
      if (!parsed.success) throw new HttpError("Enter a valid email and a password between 12 and 128 characters.");
      sessionValue = await authRequest(`signup?redirect_to=${encodeURIComponent(`${redirectOrigin()}/auth/confirm`)}`, { method: "POST", body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password, data: { display_name: parsed.data.displayName } }) });
      if (!sessionSchema.safeParse(sessionValue).success) {
        if (!userSchema.safeParse(sessionValue).success) throw new HttpError("The account service returned an invalid signup response.", 503);
        return authResponse({ user: null, confirmationRequired: true, message: "Check your email to confirm your account, then sign in." }, { headers }, 202);
      }
    } else if (action === "signin") {
      const parsed = credentialSchema.safeParse(body);
      if (!parsed.success) throw new HttpError("Enter your email and password.");
      sessionValue = await authRequest("token?grant_type=password", { method: "POST", body: JSON.stringify(parsed.data) });
    } else throw new HttpError("Unknown account action.", 404);
    const parsed = sessionSchema.safeParse(sessionValue);
    if (!parsed.success) throw new HttpError("The account service returned an invalid session.", 503);
    const user = await verifiedUser(parsed.data.access_token);
    setSession(headers, request, parsed.data);
    return authResponse({ user, confirmationRequired: false }, { headers });
  } catch (error) { return authFailure(error, headers); }
}

export async function deleteSupabaseIdentity(user: AuthUser): Promise<void> {
  if (user.provider !== "supabase") return;
  const id = user.id.replace(/^supabase:/, "");
  if (!z.string().uuid().safeParse(id).success) throw new HttpError("Invalid account identity.", 401);
  await authRequest(`admin/users/${encodeURIComponent(id)}`, { method: "DELETE" }, undefined, true);
}
