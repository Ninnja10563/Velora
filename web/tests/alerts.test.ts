import assert from "node:assert/strict";
import test from "node:test";
import { eligibleOffer, handleAlerts, runPriceMonitor, validCronAuthorization, type AlertRecord, type MonitorRepository } from "../lib/alerts.ts";
import { products } from "../lib/catalog.ts";
import type { Product, ProductProvider } from "../lib/types.ts";

function liveProduct(price = 120): Product {
  const timestamp = new Date().toISOString();
  const product = structuredClone(products[0]);
  return { ...product, source: { ...product.source, status: "live", lastChecked: timestamp }, offers: [{ ...product.offers[0], price, status: "live", availability: "in_stock", lastChecked: timestamp }] };
}
function alert(product: Product, id = "b83e3d3a-569a-4acb-a0df-8fed265c99e8"): AlertRecord {
  return { id, user_id: "supabase:owner", product_id: product.id, product_name: product.name, variant_key: product.variant, target_price: 150, currency: "USD", enabled: true, revision: 1, last_price: null, last_checked_at: null, last_error: null, lease_token: "edb6d8c8-2674-4577-946a-166932626aed", created_at: new Date().toISOString() };
}
function provider(product: Product | null, mode: "live" | "demo" = "live"): ProductProvider {
  return { id: "test-provider", mode, search: async () => product ? [product] : [], getById: async () => product, health: async () => ({ available: true, detail: "Test fixture" }) };
}

test("monitor eligibility rejects samples, stale observations, unavailable offers and changed variants", () => {
  const product = liveProduct();
  assert.ok(eligibleOffer(product, "USD", product.variant));
  assert.equal(eligibleOffer(products[0], "USD", products[0].variant), null);
  assert.equal(eligibleOffer(product, "AUD", product.variant), null);
  assert.equal(eligibleOffer(product, "USD", "a different storage configuration"), null);
  for (const availability of ["unknown", "out_of_stock", "preorder"] as const) {
    assert.equal(eligibleOffer({ ...product, offers: [{ ...product.offers[0], availability }] }, "USD", product.variant), null);
  }
  assert.equal(eligibleOffer({ ...product, source: { ...product.source, status: "cached" } }, "USD", product.variant), null);
  assert.equal(eligibleOffer({ ...product, offers: [{ ...product.offers[0], status: "cached" }] }, "USD", product.variant), null);
  assert.equal(eligibleOffer({ ...product, offers: [{ ...product.offers[0], lastChecked: new Date(Date.now() - 86400_000).toISOString() }] }, "USD", product.variant), null);
  assert.equal(eligibleOffer({ ...product, source: { ...product.source, lastChecked: new Date(Date.now() + 3600_000).toISOString() } }, "USD", product.variant), null);
  assert.equal(eligibleOffer({ ...product, source: { ...product.source, url: "http://127.0.0.1/private" } }, "USD", product.variant), null);
  assert.equal(eligibleOffer({ ...product, offers: [{ ...product.offers[0], price: 100_000_001 }] }, "USD", product.variant), null);
});

test("monitor requires a live provider before obtaining a database lease", async () => {
  const repo: MonitorRepository = { claim: async () => { throw new Error("Should not claim demo observations"); }, complete: async () => ({ status: "checked", notified: false }), fail: async () => undefined };
  await assert.rejects(() => runPriceMonitor(provider(products[0], "demo"), repo), /live product provider/);
});

test("monitor shares product retrieval, passes the lease token and uses storage-confirmed notification counts", async () => {
  const product = liveProduct();
  const records = [alert(product), alert(product, "6b606a1b-f0cd-4eeb-bf30-dc0be4cda124")];
  let calls = 0;
  const source = provider(product);
  source.getById = async (_id, options) => { assert.equal(options?.refresh, true); calls++; return product; };
  const committed: string[] = [];
  const repo: MonitorRepository = {
    claim: async () => records,
    complete: async (record, snapshot) => {
      assert.ok(record.lease_token);
      assert.equal(snapshot.status, "live");
      assert.equal(snapshot.variant, product.variant);
      assert.equal(snapshot.price, 120);
      committed.push(record.id);
      return { status: "checked", notified: record.id === records[0].id };
    },
    fail: async () => { throw new Error("Valid observations should commit"); },
  };
  assert.deepEqual(await runPriceMonitor(source, repo), { claimed: 2, checked: 2, notified: 1, skipped: 0, failed: 0 });
  assert.equal(calls, 1);
  assert.equal(committed.length, 2);
});

test("lease replays and stale observations never claim a delivered notification", async () => {
  const product = liveProduct();
  const repo: MonitorRepository = { claim: async () => [alert(product)], complete: async () => ({ status: "lease_lost", notified: false }), fail: async () => undefined };
  assert.deepEqual(await runPriceMonitor(provider(product), repo), { claimed: 1, checked: 0, notified: 0, skipped: 1, failed: 0 });
  let reason = "";
  repo.fail = async (_alert, message) => { reason = message; };
  assert.equal((await runPriceMonitor(provider({ ...product, source: { ...product.source, status: "cached" } }), repo)).skipped, 1);
  assert.match(reason, /fresh, verified/);
});

test("provider outages release the claim for a later retry and report a failure", async () => {
  const product = liveProduct();
  const source = provider(product);
  source.getById = async () => { throw new Error("Sensitive upstream error must not be stored"); };
  let message = "";
  const repo: MonitorRepository = { claim: async () => [alert(product)], complete: async () => { throw new Error("Must not record an observation"); }, fail: async (_alert, reason) => { message = reason; } };
  assert.equal((await runPriceMonitor(source, repo)).failed, 1);
  assert.match(message, /unavailable/);
  assert.ok(!message.includes("Sensitive"));
});

test("cron authorization requires the exact configured bearer secret", async () => {
  const previous = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "a".repeat(40);
    assert.equal(await validCronAuthorization(new Request("https://velora.example/api/cron/price-alerts")), false);
    assert.equal(await validCronAuthorization(new Request("https://velora.example/api/cron/price-alerts", { headers: { authorization: `Bearer ${"b".repeat(40)}` } })), false);
    assert.equal(await validCronAuthorization(new Request("https://velora.example/api/cron/price-alerts", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })), true);
    for (const invalid of [" ".repeat(40), "short", "x".repeat(1025)]) {
      process.env.CRON_SECRET = invalid;
      assert.equal(await validCronAuthorization(new Request("https://velora.example/api/cron/price-alerts", { headers: { authorization: `Bearer ${"a".repeat(40)}` } })), false);
    }
    delete process.env.CRON_SECRET;
    assert.equal(await validCronAuthorization(new Request("https://velora.example/api/cron/price-alerts", { headers: { authorization: `Bearer ${"a".repeat(40)}` } })), false);
  } finally { if (previous === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = previous; }
});

test("alert history rejects another user's identifier before querying observations", async () => {
  const keys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TRUST_SITES_IDENTITY"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  Object.assign(process.env, { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "public-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", TRUST_SITES_IDENTITY: "false" });
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  globalThis.fetch = async (input) => {
    const url = String(input); requested.push(url);
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "d8661578-80e5-42c1-bb4d-6c244cd2580a", email: "owner@example.test" });
    return Response.json([]);
  };
  try {
    const response = await handleAlerts(new Request("https://velora.example/api/alerts?history=b83e3d3a-569a-4acb-a0df-8fed265c99e8", { headers: { cookie: "velora-access=owner-token" } }));
    assert.equal(response.status, 404);
    assert.ok(requested.some((url) => url.includes("user_id=eq.supabase%3Ad8661578")));
    assert.ok(!requested.some((url) => url.includes("velora_alert_history")));
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
