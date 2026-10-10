// Server-only persistence. Import types with `import type` from account-validation in client code.
import { accountStateSchema, isPermittedDatabaseUrl, type AccountState } from "./account-validation.ts";

if (typeof window !== "undefined") throw new Error("Persistence may only run on the server.");

export class StorageUnavailableError extends Error {
  constructor() { super("Account storage is unavailable. Your browser shortlist still works."); }
}

export function storageConfigured(): boolean {
  return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_URL && isPermittedDatabaseUrl(process.env.SUPABASE_URL));
}

export function trustedIdentityEnabled(): boolean {
  return process.env.TRUST_SITES_IDENTITY === "true";
}

async function databaseRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!storageConfigured()) throw new StorageUnavailableError();
  const root = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const headers = new Headers(options.headers);
  headers.set("apikey", key);
  headers.set("Authorization", `Bearer ${key}`);
  headers.set("Content-Type", "application/json");
  try {
    const response = await fetch(`${root}/rest/v1/${path}`, {
      ...options, headers, cache: "no-store", signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new StorageUnavailableError();
    if (response.status === 204 || response.headers.get("content-length") === "0") return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  } catch {
    throw new StorageUnavailableError();
  }
}

export async function readAccountState(userId: string): Promise<AccountState | null> {
  const records = await databaseRequest<Array<{ state: unknown }>>(`user_state?user_id=eq.${encodeURIComponent(userId)}&select=state&limit=1`);
  if (!records[0]) return null;
  const result = accountStateSchema.safeParse(records[0].state);
  if (!result.success) throw new StorageUnavailableError();
  return result.data;
}

export async function writeAccountState(userId: string, state: AccountState): Promise<void> {
  // Ownership comes from the authenticated request, never a client-supplied user ID.
  await databaseRequest("profiles?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, updated_at: new Date().toISOString() }),
  });
  await databaseRequest("user_state?on_conflict=user_id", {
    method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, state: accountStateSchema.parse(state), updated_at: new Date().toISOString() }),
  });
}

export async function deleteAccountState(userId: string): Promise<void> {
  // user_state cascades. Anonymous opt-in aggregate events never contain this user ID.
  await databaseRequest(`profiles?user_id=eq.${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export type AnalyticsEvent = {
  type: "search" | "outbound_click";
  category?: string;
  productId?: string;
  retailer?: string;
  source?: string;
  success?: boolean;
  consent?: boolean;
  searchId?: string;
  recommendationId?: string;
};
type StoredEvent = AnalyticsEvent & { id: string; createdAt: string };
const runtimeEvents: StoredEvent[] = [];
const MAX_RUNTIME_EVENTS = 1000;
const RUNTIME_STARTED_AT = new Date().toISOString();
let lastAnalyticsWriteFailedAt: string | null = null;

function safeDimension(value?: string): string | undefined {
  return value?.replace(/[\r\n\u0000]/g, "").trim().slice(0, 120) || undefined;
}

export async function recordEvent(input: AnalyticsEvent): Promise<void> {
  if (input.consent !== true || (input.type !== "search" && input.type !== "outbound_click")) return;
  const event: StoredEvent = {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), type: input.type,
    category: safeDimension(input.category), productId: safeDimension(input.productId),
    retailer: safeDimension(input.retailer), source: safeDimension(input.source),
    success: input.success !== false, searchId: safeDimension(input.searchId),
    recommendationId: safeDimension(input.recommendationId),
  };
  if (!storageConfigured()) {
    runtimeEvents.push(event);
    if (runtimeEvents.length > MAX_RUNTIME_EVENTS) runtimeEvents.splice(0, runtimeEvents.length - MAX_RUNTIME_EVENTS);
    return;
  }
  try {
    const common = { id: event.id, created_at: event.createdAt, search_id: event.searchId ?? null, category: event.category ?? null };
    await databaseRequest(input.type === "search" ? "search_events" : "outbound_clicks", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify(input.type === "search" ? {
        ...common, success: event.success,
      } : {
        ...common, product_id: event.productId ?? null, retailer: event.retailer ?? null,
        source: event.source ?? null, recommendation_id: event.recommendationId ?? null,
      }),
    });
  } catch {
    // Shopping must continue even if analytics storage fails. No fallback claiming durability.
    lastAnalyticsWriteFailedAt = new Date().toISOString();
    console.warn("Velora analytics storage unavailable; event was not retained.");
  }
}

type Breakdown = { name: string; count: number }[];
export type AnalyticsSummary = {
  mode: "postgres" | "runtime-only";
  since: string;
  searchCount: number;
  failedSearchCount: number;
  outboundClickCount: number;
  linkedSearchCount: number;
  searchesWithClicks: number;
  searchToClickRate: number | null;
  popularCategories: Breakdown;
  topProducts: Breakdown;
  retailers: Breakdown;
  confirmedConversions: number | null;
  revenueByCurrency: { currency: string; amount: number }[] | null;
  conversionsConnected: boolean;
  runtimeLimit: number | null;
  lastAnalyticsWriteFailedAt: string | null;
};

function breakdown(events: StoredEvent[], field: "category" | "productId" | "retailer"): Breakdown {
  const counts = new Map<string, number>();
  for (const event of events) {
    const name = event[field];
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 8);
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  if (storageConfigured()) {
    const summary = await databaseRequest<Omit<AnalyticsSummary, "mode" | "runtimeLimit" | "lastAnalyticsWriteFailedAt" | "conversionsConnected">>("rpc/velora_admin_metrics", {
      method: "POST", body: JSON.stringify({ since_time: since }),
    });
    const conversionsConnected = process.env.AFFILIATE_CONVERSIONS_ENABLED === "true";
    return {
      ...summary, mode: "postgres", runtimeLimit: null, lastAnalyticsWriteFailedAt, conversionsConnected,
      confirmedConversions: conversionsConnected ? summary.confirmedConversions : null,
      revenueByCurrency: conversionsConnected ? summary.revenueByCurrency : null,
    };
  }
  const recent = runtimeEvents.filter((event) => event.createdAt >= since);
  const searches = recent.filter((event) => event.type === "search");
  const clicks = recent.filter((event) => event.type === "outbound_click");
  const searchIds = new Set(searches.map((event) => event.searchId).filter(Boolean));
  const clickedSearches = new Set(clicks.map((event) => event.searchId).filter((id) => id && searchIds.has(id)));
  return {
    mode: "runtime-only", since: RUNTIME_STARTED_AT > since ? RUNTIME_STARTED_AT : since,
    searchCount: searches.length, failedSearchCount: searches.filter((event) => event.success === false).length,
    outboundClickCount: clicks.length, linkedSearchCount: searchIds.size, searchesWithClicks: clickedSearches.size,
    searchToClickRate: searchIds.size ? clickedSearches.size / searchIds.size : null,
    popularCategories: breakdown(searches, "category"), topProducts: breakdown(clicks, "productId"), retailers: breakdown(clicks, "retailer"),
    confirmedConversions: null, revenueByCurrency: null, conversionsConnected: false,
    runtimeLimit: MAX_RUNTIME_EVENTS, lastAnalyticsWriteFailedAt,
  };
}
