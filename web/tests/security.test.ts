import assert from "node:assert/strict";
import test from "node:test";
import { accountStateSchema, allowAccountMutation, BodyTooLargeError, isAllowedAdmin, isPermittedDatabaseUrl, isSameOriginRequest, readBoundedJson } from "../lib/account-validation.ts";
import { databaseRequest, getAnalyticsSummary, readAccountState, recordEvent, StorageUnavailableError } from "../lib/storage.ts";

test("account writes reject cross-origin, opaque and missing origins", () => {
  const url = "https://velora.example/api/account";
  assert.equal(isSameOriginRequest(new Request(url)), false);
  assert.equal(isSameOriginRequest(new Request(url, { headers: { origin: "null" } })), false);
  assert.equal(isSameOriginRequest(new Request(url, { headers: { origin: "https://attacker.example" } })), false);
  assert.equal(isSameOriginRequest(new Request(url, { headers: { origin: "https://velora.example" } })), true);
});

test("account writes use the actual Host when Next exposes its internal bind address", () => {
  const internalUrl = "http://0.0.0.0:3000/api/account";
  const request = (origin: string, extra: Record<string, string> = {}) => new Request(internalUrl, { headers: { host: "127.0.0.1:3000", origin, ...extra } });
  assert.equal(isSameOriginRequest(request("http://127.0.0.1:3000")), true);
  assert.equal(isSameOriginRequest(request("https://attacker.example")), false);
  assert.equal(isSameOriginRequest(request("http://0.0.0.0:3000")), false);
  assert.equal(isSameOriginRequest(request("https://127.0.0.1:3000")), false);
  assert.equal(isSameOriginRequest(request("https://attacker.example", { "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" })), false);
  assert.equal(isSameOriginRequest(request("http://127.0.0.1:3000", { host: "127.0.0.1:3000/unsafe" })), false);
  assert.equal(isSameOriginRequest(request("http://127.0.0.1:3000", { host: "attacker.example@127.0.0.1:3000" })), false);
  for (const origin of ["null", "http://127.0.0.1:3000/path", "http://user@127.0.0.1:3000"]) assert.equal(isSameOriginRequest(request(origin)), false);
});

test("admin requires exact allowlist membership and denies development mock", () => {
  assert.equal(isAllowedAdmin(undefined, "owner"), false);
  assert.equal(isAllowedAdmin("owner", undefined), false);
  assert.equal(isAllowedAdmin("owner", "someone-owner"), false);
  assert.equal(isAllowedAdmin("local_seedy", "local_seedy"), false);
  assert.equal(isAllowedAdmin("owner", " first, owner , third "), true);
});

test("account schema rejects attempted ownership changes and deduplicates IDs", () => {
  const state = { savedProductIds: ["p1", "p1"], comparisonProductIds: [], preferences: { currency: "USD", location: "United States", analyticsConsent: false, theme: "system" }, searchHistory: [] };
  assert.deepEqual(accountStateSchema.parse(state).savedProductIds, ["p1"]);
  assert.equal(accountStateSchema.safeParse({ ...state, userId: "another-person" }).success, false);
  assert.equal(accountStateSchema.safeParse({ ...state, comparisonProductIds: ["1", "2", "3", "4", "5"] }).success, false);
  assert.equal(accountStateSchema.safeParse({ ...state, savedProductIds: ["https://unsafe.example"] }).success, false);
});

test("database URL requires HTTPS and rejects credentials, path and query injection", () => {
  assert.equal(isPermittedDatabaseUrl("https://project.supabase.co"), true);
  for (const value of ["http://project.supabase.co", "https://secret@project.supabase.co", "https://project.supabase.co/evil", "https://project.supabase.co?key=x", "not-url"]) assert.equal(isPermittedDatabaseUrl(value), false);
});

test("body limit applies to streamed bytes, not only Content-Length", async () => {
  const accepted = new Request("https://velora.example", { method: "POST", body: '{"value":1}' });
  assert.deepEqual(await readBoundedJson(accepted, 100), { value: 1 });
  const tooLarge = new Request("https://velora.example", { method: "POST", body: JSON.stringify({ value: "x".repeat(100) }) });
  await assert.rejects(() => readBoundedJson(tooLarge, 20), BodyTooLargeError);
});

test("account rate limit isolates users and resets after one minute", () => {
  const id = `test-${crypto.randomUUID()}`;
  for (let index = 0; index < 40; index++) assert.equal(allowAccountMutation(id, 100), true);
  assert.equal(allowAccountMutation(id, 100), false);
  assert.equal(allowAccountMutation(`${id}-other`, 100), true);
  assert.equal(allowAccountMutation(id, 60_100), true);
});

test("database transport refuses credential-bearing redirects and oversized response bodies", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-test-key";
  try {
    globalThis.fetch = async (_input, options) => {
      assert.equal(options?.redirect, "error");
      assert.equal(new Headers(options?.headers).get("apikey"), "service-test-key");
      throw new TypeError("Redirect blocked");
    };
    await assert.rejects(() => databaseRequest("profiles"), StorageUnavailableError);
    globalThis.fetch = async () => new Response(JSON.stringify({ value: "x".repeat(2_000_000) }));
    await assert.rejects(() => databaseRequest("profiles"), StorageUnavailableError);
    globalThis.fetch = async () => Response.json([{ user_id: "owner" }]);
    assert.deepEqual(await databaseRequest("profiles"), [{ user_id: "owner" }]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test("analytics require explicit consent and distinguish clicks from confirmed conversions", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const before = await getAnalyticsSummary();
    await recordEvent({ type: "search", consent: false, searchId: "declined" });
    await recordEvent({ type: "outbound_click" });
    assert.equal((await getAnalyticsSummary()).searchCount, before.searchCount);
    assert.equal((await getAnalyticsSummary()).outboundClickCount, before.outboundClickCount);
    const searchId = crypto.randomUUID();
    await recordEvent({ type: "search", consent: true, searchId, category: "headphones" });
    await recordEvent({ type: "outbound_click", consent: true, searchId, productId: "p1", retailer: "Example" });
    const after = await getAnalyticsSummary();
    assert.equal(after.mode, "runtime-only");
    assert.equal(after.searchCount, before.searchCount + 1);
    assert.equal(after.outboundClickCount, before.outboundClickCount + 1);
    assert.equal(after.searchesWithClicks, before.searchesWithClicks + 1);
    assert.equal(after.confirmedConversions, null);
    assert.equal(after.revenueByCurrency, null);
    await assert.rejects(() => readAccountState("user"), StorageUnavailableError);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
