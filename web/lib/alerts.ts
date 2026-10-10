import { z } from "zod";
import { databaseRequest, ensureProfile, storageConfigured } from "./storage.ts";
import { authFailure, authResponse, resolveUser, type AuthContext } from "./auth.ts";
import { isSameOriginRequest } from "./account-validation.ts";
import { enforceRateLimit, HttpError, isSafeExternalUrl, readJson } from "./security.ts";
import { getProductProvider } from "./providers.ts";
import type { Product, ProductOffer, ProductProvider } from "./types.ts";

const idSchema = z.string().uuid();
const productIdSchema = z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/);
const priceSchema = z.number().finite().positive().max(100_000);
const createSchema = z.object({ productId: productIdSchema, targetPrice: priceSchema, currency: z.enum(["USD", "AUD", "GBP", "EUR", "CAD"]) }).strict();
const patchSchema = z.object({ id: idSchema, targetPrice: priceSchema.optional(), enabled: z.boolean().optional() }).strict().refine((value) => value.targetPrice !== undefined || value.enabled !== undefined);

export type AlertRecord = {
  id: string; user_id: string; product_id: string; product_name: string; variant_key: string;
  target_price: number | string; currency: string; enabled: boolean; revision: number;
  last_price: number | string | null; last_checked_at: string | null; last_error: string | null;
  lease_token: string | null; created_at: string;
};

function publicAlert(record: AlertRecord) {
  return { id: record.id, productId: record.product_id, productName: record.product_name, variant: record.variant_key,
    targetPrice: Number(record.target_price), currency: record.currency, enabled: record.enabled,
    lastPrice: record.last_price === null ? null : Number(record.last_price), lastCheckedAt: record.last_checked_at,
    lastError: record.last_error, createdAt: record.created_at };
}

export function monitoringConfigured(): boolean {
  return storageConfigured() && getProductProvider().mode === "live" && configuredCronSecret() !== null;
}

function configuredCronSecret(): string | null {
  const value = process.env.CRON_SECRET;
  return value && /^[!-~]{32,1024}$/.test(value) ? value : null;
}

function maximumObservationAge(): number {
  const seconds = Number(process.env.PRICE_ALERT_MAX_AGE_SECONDS || 3600);
  return Number.isFinite(seconds) ? Math.min(86400, Math.max(60, seconds)) * 1000 : 3600_000;
}

function fresh(timestamp: string | null, now: number, maximumAge: number) {
  if (!timestamp) return false;
  const checked = Date.parse(timestamp);
  return Number.isFinite(checked) && checked <= now + 60_000 && checked >= now - maximumAge;
}

/** Only source-backed live, fresh, in-stock offers are eligible. No sample prices. */
export function eligibleOffer(product: Product, currency: string, variant: string, now = Date.now(), maximumAge = maximumObservationAge()): ProductOffer | null {
  if (product.variant !== variant || product.source.status !== "live" || !fresh(product.source.lastChecked, now, maximumAge) || !isSafeExternalUrl(product.source.url)) return null;
  return product.offers.filter((offer) => offer.currency === currency && offer.availability === "in_stock" &&
    (offer.status === undefined || offer.status === "live") && fresh(offer.lastChecked, now, maximumAge) &&
    Number.isFinite(offer.price) && offer.price > 0 && offer.price <= 100_000_000 && isSafeExternalUrl(offer.url))
    .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0] ?? null;
}

async function ownedAlert(userId: string, id: string) {
  const rows = await databaseRequest<AlertRecord[]>(`price_alerts?user_id=eq.${encodeURIComponent(userId)}&id=eq.${encodeURIComponent(id)}&limit=1`);
  if (!rows[0]) throw new HttpError("That price alert could not be found.", 404);
  return rows[0];
}

export async function handleAlerts(request: Request): Promise<Response> {
  let context: AuthContext | undefined;
  try {
    if (request.method !== "GET" && !isSameOriginRequest(request)) throw new HttpError("Same-origin requests are required.", 403);
    enforceRateLimit(request, "alerts", 60);
    context = await resolveUser(request);
    if (!context.user) throw new HttpError("Sign in to manage monitored price alerts.", 401);
    if (!storageConfigured()) throw new HttpError("Price alert storage is not configured.", 503);
    const owner = context.user.id;
    if (request.method === "GET") {
      const historyId = new URL(request.url).searchParams.get("history");
      if (historyId !== null) {
        if (!idSchema.safeParse(historyId).success) throw new HttpError("Invalid alert identifier.");
        await ownedAlert(owner, historyId);
        const observations = await databaseRequest("rpc/velora_alert_history", { method: "POST", body: JSON.stringify({ owner_id: owner, alert_id: historyId }) });
        return authResponse({ observations }, context);
      }
      const records = await databaseRequest<AlertRecord[]>(`price_alerts?user_id=eq.${encodeURIComponent(owner)}&order=created_at.desc&limit=100`);
      return authResponse({ alerts: records.map(publicAlert), monitoringAvailable: monitoringConfigured(), monitoringStatus: monitoringConfigured() ? "ready" : "not_configured", message: "Checks run only when the configured scheduler invokes the monitoring job. Last checked shows actual observations." }, context);
    }
    const body = await readJson(request, 8192);
    if (request.method === "POST") {
      const parsed = createSchema.safeParse(body);
      if (!parsed.success) throw new HttpError("Choose a product, currency, and positive price target up to 100,000.");
      if (!monitoringConfigured()) throw new HttpError("Live product data and a monitoring job secret must be configured before creating monitored alerts.", 503);
      const product = await getProductProvider().getById(parsed.data.productId, { refresh: true });
      if (!product || !eligibleOffer(product, parsed.data.currency, product.variant)) throw new HttpError("This product has no fresh, verified in-stock offer in that currency. It cannot be monitored yet.", 422);
      await ensureProfile(owner);
      const record = await databaseRequest<AlertRecord>("rpc/velora_create_price_alert", { method: "POST", body: JSON.stringify({ owner_id: owner, product_snapshot: { id: product.id, name: product.name, variant: product.variant, currency: parsed.data.currency }, target: parsed.data.targetPrice }) });
      return authResponse({ alert: publicAlert(record) }, context, 201);
    }
    if (request.method === "PATCH") {
      const parsed = patchSchema.safeParse(body);
      if (!parsed.success) throw new HttpError("Provide an alert ID and a target price or enabled setting.");
      const record = await databaseRequest<AlertRecord | null>("rpc/velora_update_price_alert", { method: "POST", body: JSON.stringify({ owner_id: owner, alert_id: parsed.data.id, new_target: parsed.data.targetPrice ?? null, new_enabled: parsed.data.enabled ?? null }) });
      if (!record) throw new HttpError("That price alert could not be found.", 404);
      return authResponse({ alert: publicAlert(record) }, context);
    }
    if (request.method === "DELETE") {
      const parsed = z.object({ id: idSchema }).strict().safeParse(body);
      if (!parsed.success) throw new HttpError("Provide a valid alert ID.");
      const deleted = await databaseRequest<AlertRecord[]>(`price_alerts?user_id=eq.${encodeURIComponent(owner)}&id=eq.${parsed.data.id}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
      if (!deleted.length) throw new HttpError("That price alert could not be found.", 404);
      return authResponse({ deleted: true }, context);
    }
    throw new HttpError("Method not allowed.", 405);
  } catch (error) { return authFailure(error, context?.headers); }
}

type NotificationRecord = { id: string; product_id: string; product_name: string; price: number | string; target_price: number | string; currency: string; created_at: string; read_at: string | null };
export async function handleNotifications(request: Request): Promise<Response> {
  let context: AuthContext | undefined;
  try {
    if (request.method !== "GET" && !isSameOriginRequest(request)) throw new HttpError("Same-origin requests are required.", 403);
    enforceRateLimit(request, "notifications", 90);
    context = await resolveUser(request);
    if (!context.user) throw new HttpError("Sign in to view price notifications.", 401);
    if (!storageConfigured()) throw new HttpError("Notification storage is not configured.", 503);
    const owner = encodeURIComponent(context.user.id);
    if (request.method === "GET") {
      const rows = await databaseRequest<NotificationRecord[]>(`alert_notifications?user_id=eq.${owner}&order=created_at.desc&limit=100`);
      return authResponse({ notifications: rows.map((row) => ({ id: row.id, productId: row.product_id, productName: row.product_name, price: Number(row.price), targetPrice: Number(row.target_price), currency: row.currency, createdAt: row.created_at, readAt: row.read_at })) }, context);
    }
    const parsed = z.object({ id: idSchema, read: z.literal(true) }).strict().safeParse(await readJson(request, 1024));
    if (!parsed.success) throw new HttpError("Provide a notification ID and read: true.");
    const rows = await databaseRequest<NotificationRecord[]>(`alert_notifications?user_id=eq.${owner}&id=eq.${parsed.data.id}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ read_at: new Date().toISOString() }) });
    if (!rows.length) throw new HttpError("That notification could not be found.", 404);
    return authResponse({ updated: true }, context);
  } catch (error) { return authFailure(error, context?.headers); }
}

type Completion = { status: "checked" | "unchanged" | "lease_lost"; notified: boolean };
export interface MonitorRepository {
  claim(): Promise<AlertRecord[]>;
  complete(alert: AlertRecord, snapshot: Record<string, unknown>): Promise<Completion>;
  fail(alert: AlertRecord, reason: string): Promise<unknown>;
}
const postgresMonitor: MonitorRepository = {
  claim: () => databaseRequest<AlertRecord[]>("rpc/velora_claim_price_alerts", { method: "POST", body: JSON.stringify({ batch_size: 20 }) }),
  complete: (alert, snapshot) => databaseRequest("rpc/velora_complete_price_alert", { method: "POST", body: JSON.stringify({ alert_id: alert.id, claim_token: alert.lease_token, snapshot }) }),
  fail: (alert, reason) => databaseRequest("rpc/velora_fail_price_alert", { method: "POST", body: JSON.stringify({ alert_id: alert.id, claim_token: alert.lease_token, reason }) }),
};

export async function runPriceMonitor(provider: ProductProvider, repository: MonitorRepository = postgresMonitor) {
  if (provider.mode !== "live") throw new HttpError("A live product provider is required for price monitoring.", 503);
  const alerts = await repository.claim();
  const result = { claimed: alerts.length, checked: 0, notified: 0, skipped: 0, failed: 0 };
  const products = new Map<string, Promise<Product | null>>();
  let next = 0;
  const work = async () => {
    while (next < alerts.length) {
      const alert = alerts[next++];
      try {
        let lookup = products.get(alert.product_id);
        if (!lookup) { lookup = provider.getById(alert.product_id, { refresh: true }); products.set(alert.product_id, lookup); }
        const product = await lookup;
        const offer = product && product.id === alert.product_id ? eligibleOffer(product, alert.currency, alert.variant_key) : null;
        if (!product || !offer) {
          await repository.fail(alert, "No fresh, verified in-stock offer for this exact product variant and currency.");
          result.skipped++; continue;
        }
        const completed = await repository.complete(alert, { productId: product.id, variant: product.variant, category: product.category, brand: product.brand, model: product.model || product.name, specs: product.specs, attributeSources: product.attributeSources || {},
          offerId: offer.id, retailer: offer.retailer, price: offer.price, currency: offer.currency, checkedAt: offer.lastChecked, status: "live", availability: "in_stock", url: offer.url, sourceUrl: product.source.url });
        if (completed.status === "checked") result.checked++; else result.skipped++;
        if (completed.notified) result.notified++;
      } catch {
        result.failed++;
        try { await repository.fail(alert, "The product or storage service was unavailable. The next scheduled run will retry."); } catch { /* Lease expiry permits retry without claiming a successful check. */ }
      }
    }
  };
  await Promise.all([work(), work(), work()]);
  return result;
}

export async function validCronAuthorization(request: Request): Promise<boolean> {
  const secret = configuredCronSecret();
  const value = request.headers.get("authorization") || "";
  if (!secret || value.length > 2048) return false;
  const actual = value.match(/^Bearer ([^\s]+)$/i)?.[1] || "";
  const hash = async (text: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  const [expectedHash, actualHash] = await Promise.all([hash(secret), hash(actual)]);
  let difference = 0;
  for (let index = 0; index < expectedHash.length; index++) difference |= expectedHash[index] ^ actualHash[index];
  return difference === 0;
}

export async function handleMonitor(request: Request): Promise<Response> {
  try {
    if (!await validCronAuthorization(request)) throw new HttpError("Monitoring authorization required.", 403);
    enforceRateLimit(request, "price-monitor", 5);
    if (!monitoringConfigured()) throw new HttpError("Live product monitoring and database storage are not configured.", 503);
    return authResponse(await runPriceMonitor(getProductProvider()));
  } catch (error) { return authFailure(error); }
}
