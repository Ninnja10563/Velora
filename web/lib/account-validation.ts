import { z } from "zod";
import { requestOriginMatches } from "./security.ts";

const productId = z.string().trim().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);

export const accountStateSchema = z.object({
  savedProductIds: z.array(productId).max(100).transform((ids) => [...new Set(ids)]),
  comparisonProductIds: z.array(productId).max(4).transform((ids) => [...new Set(ids)]),
  preferences: z.object({
    currency: z.enum(["USD", "AUD", "GBP", "EUR", "CAD"]),
    location: z.string().trim().max(100),
    analyticsConsent: z.boolean(),
    theme: z.enum(["light", "dark", "system"]),
  }).strict(),
  searchHistory: z.array(z.object({
    query: z.string().trim().min(1).max(1000),
    createdAt: z.string().datetime(),
    budget: z.number().positive().max(1_000_000).optional(),
  }).strict()).max(50),
}).strict();

export type AccountState = z.infer<typeof accountStateSchema>;

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null") return false;
  return requestOriginMatches(request);
}

export function isAllowedAdmin(userId: string | null | undefined, allowlist: string | undefined): boolean {
  if (!userId || userId === "local_seedy") return false;
  const ids = (allowlist ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  return ids.includes(userId);
}

export function isPermittedDatabaseUrl(value: string, allowLoopback = false): boolean {
  try {
    const url = new URL(value);
    const transport = url.protocol === "https:" || (allowLoopback && url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
    return transport && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export class BodyTooLargeError extends Error {}

export async function readBoundedJson(request: Request, maxBytes = 70_000): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new BodyTooLargeError();
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing body");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

// A runtime backstop. A distributed limiter should be added at the production edge.
const accountRequests = new Map<string, { startedAt: number; count: number }>();
export function allowAccountMutation(userId: string, now = Date.now()): boolean {
  const previous = accountRequests.get(userId);
  if (!previous || now - previous.startedAt >= 60_000) {
    if (accountRequests.size >= 1000) accountRequests.delete(accountRequests.keys().next().value!);
    accountRequests.set(userId, { startedAt: now, count: 1 });
    return true;
  }
  previous.count += 1;
  return previous.count <= 40;
}
