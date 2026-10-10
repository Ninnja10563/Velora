import test from "node:test";
import assert from "node:assert/strict";
import { products, categories } from "../lib/catalog.ts";
import { extractBudget, rankProducts, searchProducts } from "../lib/search.ts";
import { deduplicateProducts, inferIntent } from "../lib/providers.ts";
import { enforceRateLimit, HttpError, isSafeExternalUrl, readJson, resolveAffiliateUrl, searchInputSchema } from "../lib/security.ts";
import { POST as searchRoute } from "../app/api/search/route.ts";
import { GET as outboundRoute } from "../app/api/outbound/route.ts";

test("all ten categories have sample products with honest provenance and no invented reviews", () => {
  assert.equal(categories.length, 10);
  assert.ok(products.length >= 18);
  for (const category of categories) assert.ok(products.some(product => product.category === category.id));
  for (const product of products) {
    assert.equal(product.source.status, "demo");
    assert.equal(product.source.lastChecked, null);
    assert.equal(product.rating, null);
    assert.equal(product.reviewCount, null);
    assert.ok(product.offers.every(offer => offer.availability === "unknown" && offer.lastChecked === null && isSafeExternalUrl(offer.url)));
  }
});

test("natural-language budgets support separators, decimals, and thousands", () => {
  assert.equal(extractBudget("gaming laptop under $1,500"), 1500);
  assert.equal(extractBudget("headphones with a budget of 99.95"), 99.95);
  assert.equal(extractBudget("laptop below 1.5k"), 1500);
  assert.equal(extractBudget("I need running shoes"), undefined);
  assert.equal(extractBudget("headphones under $300. Actually, under $100"), 100);
  assert.equal(extractBudget("headphones under $300. Actually $100 please"), 100);
});

test("gaming laptops stay within the hard budget and exclude non-gaming configurations", () => {
  const result = rankProducts({ query: "Find the best gaming laptop under $1,500" });
  assert.equal(result.intent.budget, 1500);
  assert.ok(result.products.length >= 2);
  assert.ok(result.products.every(product => product.tags.includes("gaming") && product.tags.includes("laptop") && product.price <= 1500));
  assert.ok(result.products.every(product => product.matchedNeeds.includes("gaming")));
  assert.equal(result.mode, "demo");
});

test("a named unsupported model or GPU does not silently substitute a different model", () => {
  assert.equal(rankProducts({ query: "iPhone 99 under $900" }).products.length, 0);
  assert.equal(rankProducts({ query: "gaming laptop with RTX 4090", budget: 1500 }).products.length, 0);
  assert.equal(rankProducts({ query: "laptop with 32 GB RAM" }).products.length, 0);
  assert.equal(rankProducts({ query: "iPhone 15 Pro under $900" }).products.length, 0);
  assert.equal(rankProducts({ query: "Apple iPhone 15 Pro Max" }).products.length, 0);
  assert.equal(rankProducts({ query: "Google Pixel 8a Pro" }).products.length, 0);
  assert.equal(rankProducts({ query: "MacBook Air M2 512GB" }).products.length, 0);
  assert.equal(rankProducts({ query: "MacBook Air M3 512GB" }).products.length, 0);
  assert.equal(rankProducts({ query: "MacBook Air M3 Pro" }).products.length, 0);
  assert.equal(rankProducts({ query: "Bose QuietComfort Ultra headphones" }).products.length, 0);
  assert.deepEqual(rankProducts({ query: "MacBook Air M3 256GB" }).products.map(product => product.id), ["macbook-air-m3"]);
  assert.deepEqual(rankProducts({ query: "Apple iPhone 15 128 GB" }).products.map(product => product.id), ["iphone-15"]);
});

test("quoted known model numbers resolve without an explicit brand or product category", () => {
  assert.deepEqual(rankProducts({ query: '"WH-1000XM5" under $350' }).products.map(product => product.id), ["sony-wh1000xm5"]);
  assert.deepEqual(rankProducts({ query: '"WH-CH720N"' }).products.map(product => product.id), ["sony-ch720n"]);
  assert.deepEqual(rankProducts({ query: '"G2724D"' }).products.map(product => product.id), ["dell-g2724d"]);
  assert.deepEqual(rankProducts({ query: '"27UP850-W"' }).products.map(product => product.id), ["lg-27up850"]);
});

test("a budget excludes every over-budget result without widening the budget", () => {
  const result = rankProducts({ query: "wireless headphones", budget: 90 });
  assert.deepEqual(result.products.map(product => product.id), ["soundcore-q30"]);
  const empty = rankProducts({ query: "headphones", budget: 10 });
  assert.equal(empty.products.length, 0);
  assert.equal(empty.intent.budget, 10);
  assert.match(empty.clarification || "", /budget has been kept unchanged/);
});

test("brand and category filters are hard filters", () => {
  const result = rankProducts({ query: "noise cancelling headphones", brand: "Sony", category: "electronics" });
  assert.equal(result.products.length, 2);
  assert.ok(result.products.every(product => product.brand === "Sony"));
  assert.equal(rankProducts({ query: "headphones", category: "home" }).products.length, 0);
  assert.ok(rankProducts({ query: "MacBook for studying" }).products.every(product => product.brand === "Apple"));
  assert.ok(rankProducts({ query: "headphones but not Sony" }).products.every(product => product.brand !== "Sony"));
});

test("a conversational lower budget respects both the new limit and the explicit budget cap", () => {
  const result = rankProducts({ query: "headphones under $300. Now under $100", budget: 250 });
  assert.equal(result.intent.budget, 100);
  assert.ok(result.products.every(product => product.price <= 100));
  assert.equal(rankProducts({ query: "headphones under $300", budget: 90 }).intent.budget, 90);
  assert.equal(rankProducts({ query: "waterproof headphones" }).products.length, 0);
  const bareCurrency = rankProducts({ query: "headphones under $300. Actually $100 please" });
  assert.equal(bareCurrency.intent.budget, 100);
  assert.ok(bareCurrency.products.every(product => product.price <= 100));
});

test("unknown requests ask a clarification and never return unrelated catalog products", () => {
  const result = rankProducts({ query: "Please find a quantum teleportation machine" });
  assert.equal(result.products.length, 0);
  assert.ok(result.clarification);
  assert.equal(rankProducts({ query: "wireless keyboard for my home office" }).products.length, 0);
  assert.equal(rankProducts({ query: "a phone case under $30" }).products.length, 0);
  assert.equal(rankProducts({ query: "keyboard for a laptop" }).products.length, 0);
});

test("laptop bags resolve to backpacks rather than computers", () => {
  const result = rankProducts({ query: "laptop bag for travel" });
  assert.equal(result.intent.category, "travel");
  assert.ok(result.products.length > 0);
  assert.ok(result.products.every(product => product.tags.includes("backpack")));
});

test("home-office discovery is useful without a product-specific query", () => {
  const result = rankProducts({ query: "Upgrade my home office" });
  assert.equal(result.intent.category, "office");
  assert.ok(result.products.length > 0);
  assert.ok(result.products.every(product => product.category === "office"));
});

test("gym headphones require supporting sample suitability and other needs remain explicit", () => {
  const result = rankProducts({ query: "wireless headphones for studying, travelling, and the gym" });
  assert.deepEqual(result.products.map(product => product.id), ["beats-fit-pro"]);
  assert.ok(result.products[0].matchedNeeds.includes("gym"));
  assert.ok(result.warnings.some(warning => warning.includes("studying")));
});

test("currency is never converted or relabeled without an exchange-rate source", () => {
  for (const input of [{ query: "headphones under A$200" }, { query: "laptop under £900" }, { query: "running shoes", currency: "EUR" }]) {
    const result = rankProducts(input);
    assert.equal(result.products.length, 0);
    assert.match(result.summary, /USD prices only/);
  }
});

test("ranking is auditable matching evidence, then sample price; no quality score is generated", () => {
  const result = rankProducts({ query: "headphones for travel", priorities: ["battery life"] });
  let lastCount = Infinity;
  let lastPrice = 0;
  for (const product of result.products) {
    assert.ok(product.matchedNeeds.every(need => product.tags.includes(need)));
    assert.ok(product.matchedNeeds.length <= lastCount);
    if (product.matchedNeeds.length === lastCount) assert.ok(product.price >= lastPrice);
    lastCount = product.matchedNeeds.length;
    lastPrice = product.price;
    assert.ok(!("score" in product));
  }
});

test("deduplication merges same-configuration offers but preserves different storage variants", () => {
  const first = products[0];
  const copy = { ...first, id: "duplicate-listing", offers: [{ ...first.offers[0], id: "alternate-offer", retailer: "Another approved retailer", url: "https://retailer.example.com/item", price: 280 }] };
  const different = { ...first, id: "other-variant", variant: "Silver" };
  const merged = deduplicateProducts([first, copy, different]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].offers.length, 2);
  assert.equal(merged[0].price, 280);
  assert.equal(first.offers.length, 1, "source catalog is not mutated");
});

test("server schema rejects invalid budgets, unknown categories, and hostile extra fields", () => {
  for (const value of [{ query: "x", budget: -1 }, { query: "x", budget: Infinity }, { query: "x", category: "invented" }, { query: "x", url: "https://evil.example" }, { query: "a".repeat(1001) }]) assert.equal(searchInputSchema.safeParse(value).success, false);
  assert.equal(searchInputSchema.safeParse({ query: "headphones", budget: 150, analyticsConsent: false }).success, true);
});

test("body streaming enforces size without relying on Content-Length", async () => {
  await assert.rejects(readJson(new Request("https://velora.example/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "a".repeat(100) }) }), 50), (error: unknown) => error instanceof HttpError && error.status === 413);
  await assert.rejects(readJson(new Request("https://velora.example/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: "{bad}" })), (error: unknown) => error instanceof HttpError && error.status === 400);
});

test("redirect destinations reject script, credential, local, and unexpected host URLs", () => {
  for (const url of ["javascript:alert(1)", "http://sony.com", "https://user:password@sony.com", "https://127.0.0.1/admin", "https://localhost", "https://[::1]", "https://sony.com.evil.example"]) assert.equal(isSafeExternalUrl(url, ["sony.com"]), false);
  assert.equal(isSafeExternalUrl("https://sony.com/product?campaign=approved", ["sony.com"]), true);
});

test("unconfigured affiliate links resolve to the exact ordinary product URL", () => {
  const before = process.env.AFFILIATE_LINKS_JSON;
  delete process.env.AFFILIATE_LINKS_JSON;
  try {
    const offer = products[0].offers[0];
    assert.deepEqual(resolveAffiliateUrl(offer.id, offer.url), { url: offer.url, affiliate: false });
  } finally { if (before !== undefined) process.env.AFFILIATE_LINKS_JSON = before; }
});

test("rate limiting bounds repeated requests within a time window", () => {
  const request = new Request("https://velora.example/api/search");
  const scope = `test-${crypto.randomUUID()}`;
  enforceRateLimit(request, scope, 2);
  enforceRateLimit(request, scope, 2);
  assert.throws(() => enforceRateLimit(request, scope, 2), (error: unknown) => error instanceof HttpError && error.status === 429);
});

test("unconfigured AI falls back to a functional and clearly disclosed local parser", async () => {
  const before = process.env.AI_INTENT_ENDPOINT;
  delete process.env.AI_INTENT_ENDPOINT;
  try {
    const result = await searchProducts({ query: "office chair", budget: 300 });
    assert.deepEqual(result.products.map(product => product.id), ["ikea-markus"]);
    assert.ok(result.warnings.some(warning => warning.includes("No external AI")));
  } finally { if (before !== undefined) process.env.AI_INTENT_ENDPOINT = before; }
});

test("search HTTP route validates and returns a grounded end-to-end shopping result", async () => {
  const request = new Request("https://velora.example/api/search", { method: "POST", headers: { "content-type": "application/json", origin: "https://velora.example" }, body: JSON.stringify({ query: "gaming laptop under $1,000" }) });
  const response = await searchRoute(request);
  assert.equal(response.status, 200);
  const result = await response.json() as {products: {id:string}[];searchId?:string};
  assert.deepEqual(result.products.map((product: { id: string }) => product.id), ["lenovo-loq"]);
  assert.ok(result.searchId);
  const invalid = await searchRoute(new Request("https://velora.example/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "headphones", budget: -100 }) }));
  assert.equal(invalid.status, 400);
  const crossOrigin = await searchRoute(new Request("https://velora.example/api/search", { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: JSON.stringify({ query: "headphones" }) }));
  assert.equal(crossOrigin.status, 403);
});

test("outbound HTTP route resolves only known products and offers, never a query-supplied URL", async () => {
  const product = products[0];
  const response = await outboundRoute(new Request(`https://velora.example/api/outbound?product=${product.id}&url=https://attacker.example`));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), product.offers[0].url);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal((await outboundRoute(new Request("https://velora.example/api/outbound?product=unknown&url=https://attacker.example"))).status, 404);
  assert.equal((await outboundRoute(new Request(`https://velora.example/api/outbound?product=${product.id}&offer=nonexistent`))).status, 404);
});

test("AI output cannot introduce fabricated products, prices, or unknown fields", async () => {
  const endpointBefore = process.env.AI_INTENT_ENDPOINT;
  const fetchBefore = globalThis.fetch;
  process.env.AI_INTENT_ENDPOINT = "https://inference.example.com/intent";
  globalThis.fetch = async () => Response.json({ category: "electronics", products: [{ name: "Invented product", price: 1 }] });
  try {
    const result = await inferIntent({ query: "headphones" });
    assert.equal(result.intent, undefined);
    assert.ok(result.warning);
  } finally {
    globalThis.fetch = fetchBefore;
    if (endpointBefore === undefined) delete process.env.AI_INTENT_ENDPOINT;
    else process.env.AI_INTENT_ENDPOINT = endpointBefore;
  }
});
