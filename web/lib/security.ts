import { z } from "zod";
import { categoryIds } from "./types.ts";

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export const searchInputSchema = z.object({
  query: z.string().trim().min(1, "Describe what you are looking for.").max(1000),
  budget: z.number().finite().positive().max(100000).optional(),
  category: z.enum(categoryIds).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  priorities: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
  currency: z.enum(["USD", "AUD", "GBP", "EUR", "CAD"]).optional(),
  analyticsConsent: z.boolean().optional(),
}).strict();

/** Bounded streaming avoids allocating an arbitrarily large body before validation. */
export async function readJson(request: Request, maxBytes = 16384): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError("Send a JSON request body.", 415);
  const claimed = Number(request.headers.get("content-length") || 0);
  if (claimed > maxBytes) throw new HttpError("This request is too large.", 413);
  if (!request.body) throw new HttpError("A request body is required.");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new HttpError("This request is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder().decode(combined)); }
  catch { throw new HttpError("The request contains invalid JSON."); }
}

type Bucket = { count: number; expires: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

/** Single-instance guard. Use a shared edge limiter for multiple replicas in production. */
export function enforceRateLimit(request: Request, scope: string, limit = 30, windowMs = 60000): void {
  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip") || (process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() : undefined) || "anonymous";
  const key = `${scope}:${ip.slice(0, 100)}`;
  const current = buckets.get(key);
  if (current && current.expires > now) {
    if (current.count >= limit) throw new HttpError("A few too many requests. Please try again in a minute.", 429);
    current.count += 1; return;
  }
  if (buckets.size >= MAX_BUCKETS) {
    for (const [entry, bucket] of buckets) if (bucket.expires <= now) buckets.delete(entry);
    if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
  }
  buckets.set(key, { count: 1, expires: now + windowMs });
}

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message || "Please check your request." }, { status: 400 });
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status, headers: error.status === 429 ? { "Retry-After": "60" } : {} });
  console.error("Velora request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: "We could not complete that request. Please try again." }, { status: 500 });
}

export function isSafeExternalUrl(value: string, allowedHosts?: string[]): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
    const hostname = url.hostname.toLowerCase();
    if (!hostname.includes(".") || hostname.includes(":") || /^\d+(\.\d+){3}$/.test(hostname) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(hostname)) return false;
    if (allowedHosts && !allowedHosts.some(host => hostname === host.toLowerCase())) return false;
    return true;
  } catch { return false; }
}

/** Only operator-configured, approved links can replace a product's ordinary URL. */
export function resolveAffiliateUrl(offerId: string, ordinaryUrl: string): { url: string; affiliate: boolean } {
  if (!isSafeExternalUrl(ordinaryUrl)) throw new HttpError("This retailer link is unavailable.", 503);
  try {
    const links = JSON.parse(process.env.AFFILIATE_LINKS_JSON || "{}") as Record<string, unknown>;
    const candidate = Object.prototype.hasOwnProperty.call(links, offerId) ? links[offerId] : undefined;
    const hosts = (process.env.AFFILIATE_ALLOWED_HOSTS || "").split(",").map(host => host.trim()).filter(Boolean);
    hosts.push(new URL(ordinaryUrl).hostname);
    if (typeof candidate === "string" && candidate.length <= 4096 && isSafeExternalUrl(candidate, hosts)) return { url: candidate, affiliate: true };
  } catch { /* Invalid configuration safely falls back to the ordinary source URL. */ }
  return { url: ordinaryUrl, affiliate: false };
}
