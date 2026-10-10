import { expect, test } from "@playwright/test";

const fixture = "http://127.0.0.1:54321";
test.beforeEach(async ({ request }) => { await request.post(`${fixture}/__fixture/reset`); });

test("normalized fixture feed crosses the real search and outbound boundaries", async ({ request }) => {
  const response = await request.post("/api/search", { headers: { Origin: "http://127.0.0.1:3100" }, data: { query: "Wireless headphones under $100", budget: 100, analyticsConsent: false } });
  expect(response.status(), await response.text()).toBe(200);
  const result = await response.json();
  expect(["live", "cached"]).toContain(result.mode);
  expect(result.products).toHaveLength(1);
  expect(result.products[0]).toMatchObject({ id: "fixture-headphones-a", price: 89, rating: null, reviewCount: null });
  expect(result.products[0].source.name).toContain("synthetic");
  expect(result.products[0].source.lastChecked).toBeTruthy();
  const outbound = await request.get("/api/outbound?product=fixture-headphones-a&source=detail", { maxRedirects: 0 });
  expect(outbound.status()).toBe(302);
  expect(outbound.headers().location).toBe("https://retailer.example/products/fixture-headphones-a?fixture_attribution=approved-test");
  const recorded = await (await request.get(`${fixture}/__fixture/requests`)).json();
  expect(recorded.requests.some((entry: { path: string }) => entry.path === "/products")).toBeTruthy();
});

test("malformed fixture data fails visibly without substituting demo products", async ({ request }) => {
  await request.post(`${fixture}/__fixture/feed`, { data: { malformed: true } });
  const response = await request.post("/api/search", { headers: { Origin: "http://127.0.0.1:3100" }, data: { query: "Wireless headphones", analyticsConsent: false } });
  expect(response.status()).toBe(502);
  const result = await response.json();
  expect(result.error).toMatch(/schema|validat/i);
  expect(result.products).toBeUndefined();
});
