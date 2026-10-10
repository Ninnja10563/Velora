import assert from "node:assert/strict";
import test from "node:test";
import { handleAuth, resolveUser, type AuthUser } from "../lib/auth.ts";
import { GET as readAccount, PUT as writeAccount } from "../app/api/account/route.ts";

const UUID = "d8661578-80e5-42c1-bb4d-6c244cd2580a";
const user = { id: UUID, email: "shopper@example.test", user_metadata: { display_name: "Shopper" } };
const tokens = { access_token: "verified-access-token", refresh_token: "rotating-refresh-token", expires_in: 3600 };
type AuthResult = { user: AuthUser | null; confirmationRequired: boolean };
function request(action: string, body?: unknown, cookies = "") {
  return new Request(`https://velora.example/api/auth/${action}`, { method: body === undefined ? "GET" : "POST", headers: { origin: "https://velora.example", "content-type": "application/json", cookie: cookies }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

async function fixture(run: (calls: { url: string; options?: RequestInit }[]) => Promise<void>, respond: (url: string, options?: RequestInit) => Response | Promise<Response>) {
  const names = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "APP_URL", "TRUST_SITES_IDENTITY"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const previousFetch = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-test-key", SUPABASE_SERVICE_ROLE_KEY: "service-test-key", APP_URL: "https://velora.example", TRUST_SITES_IDENTITY: "false" });
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  globalThis.fetch = async (input, options) => { const url = String(input); calls.push({ url, options }); return respond(url, options); };
  try { await run(calls); }
  finally {
    globalThis.fetch = previousFetch;
    for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; }
  }
}

test("password sign-in verifies the user separately and keeps tokens in secure HttpOnly cookies", async () => {
  await fixture(async (calls) => {
    const response = await handleAuth(request("signin", { email: user.email, password: "a-long-test-password" }), "signin");
    assert.equal(response.status, 200);
    const payload = await response.json() as AuthResult;
    assert.ok(payload.user);
    assert.equal(payload.user.id, `supabase:${UUID}`);
    assert.equal(payload.user.displayName, "Shopper");
    assert.equal("access_token" in payload, false);
    assert.equal("refresh_token" in payload, false);
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every((cookie) => cookie.includes("HttpOnly") && cookie.includes("SameSite=Lax") && cookie.includes("Secure")));
    assert.ok(calls.some((call) => call.url.endsWith("/auth/v1/user")));
  }, (url) => Response.json(url.endsWith("/user") ? user : { ...tokens, user: { id: "forged-client-id" } }));
});

test("unverified cookie identity and caller-supplied identity headers never authorize an account", async () => {
  await fixture(async () => {
    const context = await resolveUser(new Request("https://velora.example/api/account", { headers: { cookie: "velora-access=forged", "oai-authenticated-user-id": "victim", "oai-authenticated-user-email": "victim@example.test" } }));
    assert.equal(context.user, null);
    assert.ok(context.headers.getSetCookie().every((cookie) => cookie.includes("Max-Age=0")));
  }, () => Response.json({ error: "bad_jwt" }, { status: 401 }));
});

test("expired tokens refresh on the server and newly issued identity is verified", async () => {
  await fixture(async (calls) => {
    const context = await resolveUser(request("session", undefined, "velora-access=expired; velora-refresh=refresh-before-rotation"));
    assert.equal(context.user?.id, `supabase:${UUID}`);
    assert.ok(context.headers.getSetCookie().some((cookie) => cookie.includes("rotating-refresh-token")));
    assert.equal(calls.filter((call) => call.url.includes("grant_type=refresh_token")).length, 1);
  }, (url, options) => {
    if (url.includes("grant_type=refresh_token")) return Response.json(tokens);
    return new Headers(options?.headers).get("authorization") === "Bearer expired" ? Response.json({}, { status: 401 }) : Response.json(user);
  });
});

test("an auth outage does not erase the session or silently authorize a stale cookie", async () => {
  await fixture(async () => {
    const response = await handleAuth(request("session", undefined, "velora-access=previous-valid-token"), "session");
    assert.equal(response.status, 503);
    assert.equal(response.headers.getSetCookie().length, 0);
  }, () => Response.json({}, { status: 503 }));
});

test("signup confirmation is honest and malformed provider responses are rejected", async () => {
  await fixture(async () => {
    const response = await handleAuth(request("signup", { email: user.email, password: "a-long-test-password" }), "signup");
    assert.equal(response.status, 202);
    assert.equal((await response.json() as AuthResult).confirmationRequired, true);
    assert.equal(response.headers.getSetCookie().length, 0);
  }, () => Response.json(user));
  await fixture(async () => {
    const response = await handleAuth(request("signup", { email: user.email, password: "a-long-test-password" }), "signup");
    assert.equal(response.status, 503);
  }, () => Response.json({ unexpected: true }));
});

test("cross-origin auth mutations are rejected before calling the provider", async () => {
  await fixture(async (calls) => {
    const response = await handleAuth(new Request("https://velora.example/api/auth/signin", { method: "POST", headers: { origin: "https://attacker.example", "content-type": "application/json" }, body: JSON.stringify({ email: user.email, password: "anything" }) }), "signin");
    assert.equal(response.status, 403);
    assert.equal(calls.length, 0);
  }, () => { throw new Error("Provider must not be called"); });
});

test("account queries derive ownership from the verified provider user, never request IDs", async () => {
  await fixture(async (calls) => {
    const response = await readAccount(new Request("https://velora.example/api/account?userId=victim", { headers: { cookie: "velora-access=verified-access-token" } }));
    assert.equal(response.status, 200);
    const query = calls.find((call) => call.url.includes("/rest/v1/user_state"));
    assert.ok(query?.url.includes(encodeURIComponent(`supabase:${UUID}`)));
    assert.ok(!query?.url.includes("victim"));
    const invalid = await writeAccount(new Request("https://velora.example/api/account", { method: "PUT", headers: { cookie: "velora-access=verified-access-token", origin: "https://velora.example", "content-type": "application/json" }, body: JSON.stringify({ userId: "victim" }) }));
    assert.equal(invalid.status, 400);
    assert.equal(calls.filter((call) => call.options?.method === "POST").length, 0);
  }, (url) => Response.json(url.includes("/rest/v1/") ? [] : user));
});
