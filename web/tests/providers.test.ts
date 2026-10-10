import test from "node:test";
import assert from "node:assert/strict";
import { products } from "../lib/catalog.ts";
import { FeedProductProvider } from "../lib/feed-provider.ts";
import { EbayProductProvider, ebayProductId, decodeEbayProductId, normalizeEbayItem } from "../lib/ebay-provider.ts";
import { deduplicateProducts, getProductProvider, inferIntent, productIdentity } from "../lib/providers.ts";
import { rankProducts, searchProducts } from "../lib/search.ts";
import { validateFeed } from "../lib/product-validation.ts";
import { enforceRateLimit, HttpError, searchInputSchema } from "../lib/security.ts";
import { GET as catalogRoute } from "../app/api/products/route.ts";
import { GET as outboundRoute } from "../app/api/outbound/route.ts";
import { POST as searchRoute } from "../app/api/search/route.ts";
import type { Product, SearchResult } from "../lib/types.ts";

const isHttp = (status: number) => (error: unknown) => error instanceof HttpError && error.status === status;
function fixture(overrides: Partial<Product> = {}): Product {
  const now = new Date().toISOString();
  const first = products[0];
  return { ...structuredClone(first), id: "feed-headphones", price: 89, source: { name: "Approved protocol fixture", url: "https://retailer.example/headphones", status: "live", lastChecked: now }, offers: [{ ...first.offers[0], id: "feed-offer", price: 89, url: "https://retailer.example/headphones", status: "live", availability: "in_stock", lastChecked: now }], ...overrides };
}
async function configured<T>(env: Record<string, string | undefined>, fetcher: typeof fetch, run: () => Promise<T>): Promise<T> {
  const vars = { AI_PROVIDER: "local", PRODUCT_PROVIDER: "feed", PRODUCT_FEED_URL: "https://approved-feed.example/products", PRODUCT_RETAILER_HOSTS: "retailer.example", PRODUCT_FEED_CACHE_SECONDS: "0", ...env };
  const previous = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(vars)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  globalThis.fetch = fetcher;
  try { return await run(); } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}

test("feed protocol authenticates, validates, preserves observation time, and marks cache reads", async () => {
  let calls = 0;
  const record = fixture();
  await configured({ PRODUCT_FEED_TOKEN: "test-feed-secret", PRODUCT_FEED_CACHE_SECONDS: "300" }, async (url, init) => {
    calls++;
    assert.equal(String(url), "https://approved-feed.example/products");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-feed-secret");
    assert.equal(init?.redirect, "error");
    return Response.json({ products: [record] });
  }, async () => {
    const provider = new FeedProductProvider();
    const fresh = await provider.search();
    assert.equal(fresh[0].source.status, "live");
    const cached = await provider.getById(record.id);
    assert.equal(cached?.source.status, "cached");
    assert.equal(cached?.source.lastChecked, record.source.lastChecked);
    assert.equal(calls, 1);
    const refreshed = await provider.getById(record.id, { refresh: true });
    assert.equal(refreshed?.source.status, "live");
    assert.equal(calls, 2);
    assert.equal(await provider.getById("../../etc/passwd"), null);
    assert.equal(calls, 2, "unsafe IDs cannot make upstream requests");
  });
});

test("feed rejects missing provenance, unsafe retailers, fake demo rows, and conflicting currency", () => {
  const record = fixture();
  const invalid = [
    { ...record, source: { ...record.source, lastChecked: null } },
    { ...record, source: { ...record.source, status: "demo" } },
    { ...record, source: { ...record.source, lastChecked: "2099-01-01T00:00:00.000Z" } },
    { ...record, offers: [{ ...record.offers[0], url: "https://attacker.example/item" }] },
    { ...record, offers: [{ ...record.offers[0], currency: "AUD" }] },
    { ...record, price: -10 },
    { ...record, inventedScore: 99 },
  ];
  for (const product of invalid) assert.throws(() => validateFeed({ products: [product] }, ["retailer.example"]), isHttp(502));
  assert.throws(() => validateFeed({ products: [record, record] }, ["retailer.example"]), isHttp(502));
  const old = "2020-01-01T00:00:00.000Z";
  const stale = validateFeed({ products: [{ ...record, source: { ...record.source, lastChecked: old }, offers: [{ ...record.offers[0], lastChecked: old, affiliateUrl: "https://unapproved.example/track" }] }] }, ["retailer.example"])[0];
  assert.equal(stale.source.status, "cached");
  assert.equal(stale.offers[0].status, "cached");
  assert.equal(stale.source.lastChecked, old);
  assert.equal(stale.offers[0].affiliateUrl, undefined, "feed data alone never establishes an affiliate partnership");
});

test("a selected but unavailable provider returns errors and never silently substitutes demo data", async () => {
  await configured({ PRODUCT_FEED_URL: undefined }, async () => { throw new Error("network must not run"); }, async () => {
    assert.equal(getProductProvider().mode, "unconfigured");
    const response = await catalogRoute(new Request("https://velora.example/api/products"));
    assert.equal(response.status, 503);
    const failure = await response.json();
    assert.ok(failure && typeof failure === "object");
    assert.ok(!("products" in failure));
  });
  await configured({}, async () => new Response("service unavailable", { status: 503 }), async () => {
    await assert.rejects(searchProducts({ query: "headphones" }), isHttp(503));
  });
});

test("available-offer pricing, exact-variant deduplication, and outbound lookup agree", async () => {
  const first = fixture({ price: 10, offers: [{ ...fixture().offers[0], id: "unavailable-offer", availability: "out_of_stock", price: 10 }] });
  const second = fixture({ id: "same-model-other-store", price: 100, offers: [{ ...fixture().offers[0], id: "available-offer", price: 100, url: "https://retailer.example/second-store" }] });
  await configured({}, async () => Response.json({ products: [first, second] }), async () => {
    const result = await searchProducts({ query: "headphones", budget: 120 });
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].price, 100);
    assert.equal(result.products[0].offers.length, 2);
    assert.equal((await searchProducts({ query: "headphones", budget: 50 })).products.length, 0);
    const response = await outboundRoute(new Request(`https://velora.example/api/outbound?product=${result.products[0].id}&offer=available-offer&url=https://attacker.example`));
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), second.offers[0].url);
    const blocked = await outboundRoute(new Request(`https://velora.example/api/outbound?product=${first.id}&offer=unavailable-offer`));
    assert.equal(blocked.status, 409);
    const detail = await catalogRoute(new Request(`https://velora.example/api/products?id=${second.id}`));
    const body = await detail.json() as { product: Product; mode: Product["source"]["status"]; provider: string };
    assert.equal(body.product.id, second.id);
    assert.equal(body.product.offers.length, 2);
  });
  const a = fixture({ variant: "AB-C" });
  const b = fixture({ id: "other", variant: "A-BC" });
  assert.notEqual(productIdentity(a), productIdentity(b), "punctuation cannot erase variant boundaries");
  assert.equal(deduplicateProducts([a, b]).length, 2);
});

test("non-USD feed recommendations retain real currencies and strict model constraints", async () => {
  const aud = fixture(); aud.currency = "AUD"; aud.offers[0].currency = "AUD";
  await configured({}, async () => Response.json({ products: [aud] }), async () => {
    const response = await searchRoute(new Request("https://velora.example/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: '"WH-1000XM5" under A$100', currency: "AUD", location: "Australia" }) }));
    assert.equal(response.status, 200);
    const result = await response.json() as SearchResult;
    assert.equal(result.products.length, 1);
    assert.equal(result.products[0].currency, "AUD");
    assert.equal(result.mode, "live");
    assert.match(result.summary, /100 AUD/);
    assert.equal((await searchProducts({ query: '"WH-1000XM6"', currency: "AUD" })).products.length, 0);
  });
});

function ebayItem(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "v1|123456789012|0", title: "Sony WH-1000XM5 Wireless Noise Cancelling Headphones Black", brand: "Sony", itemWebUrl: "https://www.ebay.com/itm/123456789012", price: { value: "89.00", currency: "USD" },
    image: { imageUrl: "https://i.ebayimg.com/images/test.jpg" }, condition: "New", buyingOptions: ["FIXED_PRICE"],
    localizedAspects: [{ name: "Model", value: "WH-1000XM5" }, { name: "Color", value: "Black" }],
    estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK" }],
    itemAffiliateWebUrl: "https://www.ebay.com/itm/123456789012?campid=1234567890",
    ...overrides,
  };
}

test("eBay uses OAuth client credentials, marketplace Browse search, and validated item detail IDs", async () => {
  let oauthCalls = 0;
  let detailCalls = 0;
  await configured({ PRODUCT_PROVIDER: "ebay", EBAY_CLIENT_ID: "test-client", EBAY_CLIENT_SECRET: "test-secret", EBAY_ENVIRONMENT: "production", EBAY_CAMPAIGN_ID: "1234567890", EBAY_MARKETPLACE_ID: undefined }, async (url, init) => {
    const address = new URL(String(url));
    assert.equal(address.origin, "https://api.ebay.com");
    const headers = new Headers(init?.headers);
    if (address.pathname === "/identity/v1/oauth2/token") {
      oauthCalls++;
      assert.match(headers.get("authorization") || "", /^Basic /);
      assert.equal(new URLSearchParams(String(init?.body)).get("grant_type"), "client_credentials");
      return Response.json({ access_token: "test-access-token", expires_in: 7200 });
    }
    assert.equal(headers.get("authorization"), "Bearer test-access-token");
    assert.equal(headers.get("x-ebay-c-marketplace-id"), "EBAY_US");
    assert.equal(headers.get("x-ebay-c-enduserctx"), "affiliateCampaignId=1234567890");
    if (address.pathname === "/buy/browse/v1/item_summary/search") {
      assert.match(address.searchParams.get("filter") || "", /price:\[0\.\.100\],priceCurrency:USD/);
      return Response.json({ itemSummaries: [{ itemId: "v1|123456789012|0" }] });
    }
    assert.equal(decodeURIComponent(address.pathname), "/buy/browse/v1/item/v1|123456789012|0");
    detailCalls++;
    return Response.json(ebayItem());
  }, async () => {
    const result = await searchProducts({ query: "wireless headphones under $100", budget: 100 });
    assert.equal(result.products.length, 1);
    const product = result.products[0];
    assert.equal(product.source.status, "live");
    assert.equal(product.rating, null);
    assert.equal(product.offers[0].availability, "in_stock");
    assert.equal(productProviderMode(), "live");
    const redirect = await outboundRoute(new Request(`https://velora.example/api/outbound?product=${product.id}`));
    assert.equal(redirect.headers.get("location"), ebayItem().itemAffiliateWebUrl);
    assert.equal(oauthCalls, 1);
    assert.equal(detailCalls, 1);
    await getProductProvider().getById(product.id, { refresh: true });
    assert.equal(detailCalls, 2);
    assert.equal(await getProductProvider().getById("https://attacker.example"), null);
  });
});
function productProviderMode() { return getProductProvider().mode; }

test("eBay excludes expired, accessory, auction-only records and preserves seller-listing identity", () => {
  const normal = normalizeEbayItem(ebayItem(), "EBAY_US")!;
  assert.equal(normal.offers[0].affiliateUrl, undefined);
  assert.equal(normalizeEbayItem(ebayItem({ itemEndDate: "2020-01-01T00:00:00.000Z" }), "EBAY_US"), null);
  assert.equal(normalizeEbayItem(ebayItem({ buyingOptions: ["AUCTION"] }), "EBAY_US"), null);
  assert.equal(normalizeEbayItem(ebayItem({ title: "Replacement earpads for Sony WH-1000XM5" }), "EBAY_US"), null);
  assert.throws(() => normalizeEbayItem(ebayItem({ itemWebUrl: "https://attacker.example" }), "EBAY_US"), isHttp(502));
  assert.equal(decodeEbayProductId(ebayProductId("../../evil", "EBAY_US")), null);
  const other = normalizeEbayItem(ebayItem({ itemId: "v1|123456789013|0" }), "EBAY_US")!;
  assert.equal(deduplicateProducts([normal, other]).length, 2, "a matching marketing model is insufficient evidence of identical seller variants");
  assert.ok(!normalizeEbayItem(ebayItem({ title: "Sony wired headphones without Bluetooth" }), "EBAY_US")!.tags.includes("wireless"));
});

test("eBay sandbox and missing credentials are honestly differentiated", async () => {
  await configured({ PRODUCT_PROVIDER: "ebay", EBAY_CLIENT_ID: undefined, EBAY_CLIENT_SECRET: undefined }, async () => { throw new Error("network must not run"); }, async () => {
    const provider = new EbayProductProvider();
    assert.equal(provider.mode, "unconfigured");
    await assert.rejects(provider.search({ query: "headphones" }), isHttp(503));
  });
  await configured({ PRODUCT_PROVIDER: "ebay", EBAY_ENVIRONMENT: "sandbox", EBAY_CLIENT_ID: "test", EBAY_CLIENT_SECRET: "test" }, async url => String(url).includes("oauth2/token") ? Response.json({ access_token: "test", expires_in: 7200 }) : Response.json(ebayItem()), async () => {
    const product = await new EbayProductProvider().getById(ebayProductId("v1|123456789012|0", "EBAY_US"));
    assert.equal(product?.source.status, "demo");
    assert.match(product?.source.name || "", /Sandbox/);
    assert.equal(product?.offers[0].availability, "unknown");
    assert.equal(product?.offers[0].affiliateUrl, undefined);
  });
});

function toolResponse(args: Record<string, unknown>) {
  return Response.json({ status: "completed", output: [{ type: "function_call", name: "search_products", arguments: JSON.stringify(args) }] });
}
const toolArgs = { query: "wireless headphones", category: "electronics", brand: null, budget: 500, currency: "USD", priorities: ["wireless"], clarification: null };

test("OpenAI Responses strict tool calls dispatch approved retrieval without relaxing budget or inventing facts", async () => {
  let aiCalls = 0;
  let feedCalls = 0;
  const record = fixture();
  const expensive = fixture({ id: "expensive", name: "Another Wireless Headphone", variant: "Premium", price: 200, offers: [{ ...record.offers[0], id: "expensive-offer", price: 200 }] });
  await configured({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-configured-model" }, async (url, init) => {
    if (String(url) === "https://api.openai.com/v1/responses") {
      aiCalls++;
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.model, "test-configured-model");
      assert.equal(body.tools[0].strict, true);
      assert.equal(body.tools[0].parameters.additionalProperties, false);
      assert.deepEqual(body.tool_choice, { type: "function", name: "search_products" });
      assert.equal(body.parallel_tool_calls, false);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-key");
      return toolResponse(toolArgs);
    }
    assert.equal(String(url), "https://approved-feed.example/products");
    feedCalls++;
    return Response.json({ products: [record, expensive] });
  }, async () => {
    const result = await searchProducts({ query: "wireless headphones under $100", budget: 100 });
    assert.equal(result.assistantMode, "openai");
    assert.equal(result.intent.budget, 100);
    assert.deepEqual(result.products.map(product => product.id), [record.id]);
    assert.equal(result.products[0].price, 89);
    assert.equal(aiCalls, 1);
    assert.equal(feedCalls, 1);
  });
});

test("OpenAI rejects unknown fields or tools and has no silent fallback when selected", async () => {
  await configured({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model" }, async () => toolResponse({ ...toolArgs, products: [{ name: "Invented", price: 1 }] }), async () => {
    await assert.rejects(inferIntent({ query: "headphones" }), isHttp(502));
  });
  await configured({ AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model" }, async () => Response.json({ output: [{ type: "function_call", name: "arbitrary_network_access", arguments: "{}" }] }), async () => {
    await assert.rejects(inferIntent({ query: "headphones" }), isHttp(502));
  });
  await configured({ AI_PROVIDER: "openai", OPENAI_API_KEY: undefined, OPENAI_MODEL: undefined }, async () => { throw new Error("network must not run"); }, async () => {
    await assert.rejects(searchProducts({ query: "headphones" }), isHttp(503));
  });
});

test("untrusted Cloudflare IP headers cannot create independent rate-limit buckets", async () => {
  await configured({ TRUST_CLOUDFLARE: undefined, TRUST_PROXY: undefined }, async () => { throw new Error("not used"); }, async () => {
    const scope = crypto.randomUUID();
    enforceRateLimit(new Request("https://velora.example", { headers: { "cf-connecting-ip": "192.0.2.1" } }), scope, 1);
    assert.throws(() => enforceRateLimit(new Request("https://velora.example", { headers: { "cf-connecting-ip": "192.0.2.2" } }), scope, 1), isHttp(429));
    assert.equal(searchInputSchema.safeParse({ query: "headphones", location: "Australia" }).success, true);
    assert.equal(searchInputSchema.safeParse({ query: "headphones", location: "x".repeat(101) }).success, false);
  });
});

test("out-of-stock listings never become purchase recommendations", () => {
  const record = fixture(); record.offers[0].availability = "out_of_stock";
  assert.equal(rankProducts({ query: "headphones" }, [record]).products.length, 0);
});

test("a live feed can add product types without substituting a related accessory", () => {
  const keyboard = fixture({ id: "keyboard", name: "Example Wireless Keyboard", brand: "Example", category: "office", tags: ["keyboard", "wireless"] });
  const mouse = fixture({ id: "mouse", name: "Example Wireless Mouse", brand: "Example", category: "office", tags: ["mouse", "wireless"] });
  const result = rankProducts({ query: "wireless keyboard for my laptop and home office" }, [keyboard, mouse]);
  assert.deepEqual(result.products.map(product => product.id), ["keyboard"]);
  const vacuum = fixture({ id: "vacuum", name: "Example Vacuum Cleaner", brand: "Example", category: "home", tags: ["vacuum cleaner"] });
  assert.deepEqual(rankProducts({ query: "a vacuum cleaner" }, [vacuum, mouse]).products.map(product => product.id), ["vacuum"]);
});

test("deduplication cannot merge incomplete variant labels with conflicting specifications", () => {
  const first = fixture({ model: "Example Laptop", variant: "default", specs: { Memory: "8 GB", Storage: "256 GB" } });
  const other = fixture({ id: "other-memory", model: "Example Laptop", variant: "default", specs: { Memory: "16 GB", Storage: "256 GB" } });
  assert.equal(deduplicateProducts([first, other]).length, 2);
  const reordered = fixture({ id: "same-config", model: "Example Laptop", variant: "default", specs: { Storage: "256 GB", Memory: "8 GB" } });
  assert.equal(productIdentity(first), productIdentity(reordered));
});

test("named base, Pro, Max and Plus live models are separate requirements", () => {
  const phone = (id: string, name: string) => fixture({ id, name, brand: "Apple", category: "phones", tags: ["phone"], variant: "128 GB" });
  const models = [phone("base", "Apple iPhone 15"), phone("pro", "Apple iPhone 15 Pro"), phone("max", "Apple iPhone 15 Pro Max")];
  assert.deepEqual(rankProducts({ query: "iPhone 15" }, models).products.map(product => product.id), ["base"]);
  assert.deepEqual(rankProducts({ query: "iPhone 15 Pro" }, models).products.map(product => product.id), ["pro"]);
  const samsung = [fixture({ id: "s24", name: "Samsung Galaxy S24", brand: "Samsung", category: "phones", tags: ["phone"] }), fixture({ id: "s24plus", name: "Samsung Galaxy S24 Plus", brand: "Samsung", category: "phones", tags: ["phone"] })];
  assert.deepEqual(rankProducts({ query: "Galaxy S24+" }, samsung).products.map(product => product.id), ["s24plus"]);
});
