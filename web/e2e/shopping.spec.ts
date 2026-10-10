import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

type SearchProduct = { id: string; name: string; brand: string; price: number; currency: string };

async function home(page: Page) {
  await page.goto("/");
  // Wait for client effects before clicking server-rendered controls during a cold dev start.
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/, { timeout: 60_000 });
}

async function search(page: Page, query: string, budget?: string) {
  await page.getByRole("textbox", { name: "What are you looking for?" }).fill(query);
  if (budget !== undefined) await page.getByRole("spinbutton", { name: "Maximum budget" }).fill(budget);
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith("/api/search") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Find my match", exact: true }).click();
  const response = await responsePromise;
  const data = await response.json() as { products: SearchProduct[]; clarification?: string };
  expect(response.status(), JSON.stringify(data)).toBe(200);
  await expect(page.getByRole("button", { name: "Find my match", exact: true })).toBeEnabled();
  return data;
}

function card(page: Page, name: string) {
  return page.getByRole("article").filter({ has: page.getByRole("button", { name, exact: true }) });
}

async function assertNoHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
}

async function screenshot(page: Page, filename: string) {
  const output = path.resolve("outputs");
  await mkdir(output, { recursive: true });
  await page.locator("img").evaluateAll(images => Promise.all(images.map(image => {
    (image as HTMLImageElement).loading = "eager";
    if ((image as HTMLImageElement).complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  })));
  await page.screenshot({ path: path.join(output, filename), fullPage: true });
}

test("budgeted discovery, shortlist persistence, comparison, source links, and honest price targets", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await home(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Find your kind of");
  const data = await search(page, "Wireless headphones for studying under $200", "200");
  expect(data.products.length).toBeGreaterThanOrEqual(2);
  expect(data.products.every(product => product.currency === "USD" && product.price <= 200)).toBeTruthy();
  await expect(page.getByRole("article")).toHaveCount(data.products.length);
  const visiblePrices = await page.locator("article .product-price-row strong").allTextContents();
  expect(visiblePrices.every(price => Number(price.replace(/[^0-9.]/g, "")) <= 200)).toBeTruthy();
  await expect(page.getByText("Demo catalog · sample prices", { exact: true })).toBeVisible();

  const chosen = data.products.slice(0, 2);
  for (const product of chosen) {
    await card(page, product.name).getByRole("button", { name: `Save ${product.name}`, exact: true }).click();
    const savedButton = card(page, product.name).getByRole("button", { name: `Unsave ${product.name}`, exact: true });
    await expect(savedButton).toHaveAttribute("aria-pressed", "true");
    await expect(savedButton).toBeFocused();
    await card(page, product.name).getByRole("button", { name: "Compare", exact: true }).click();
    await expect(card(page, product.name).getByRole("button", { name: "Compare", exact: true })).toHaveAttribute("aria-pressed", "true");
  }

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Saved products/ }).click();
  await expect(page.getByRole("heading", { name: "Your shortlist." })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(2);
  for (const product of chosen) await expect(card(page, product.name)).toBeVisible();

  await page.getByRole("button", { name: "Compare now" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByRole("table").locator("thead th")).toHaveCount(3);
  for (const product of chosen) await expect(page.getByRole("columnheader").filter({ hasText: product.name })).toBeVisible();
  await expect(page.getByRole("table")).toContainText("Not verified in the demo catalog");
  await expect(page.getByRole("table")).toContainText("Unverified sample — not a live offer");

  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Saved products/ }).click();
  await card(page, chosen[0].name).getByRole("button", { name: `Details for ${chosen[0].name}`, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: chosen[0].name, exact: true })).toBeVisible();
  const source = page.getByRole("link", { name: "Velora sample catalog · manufacturer reference", exact: true });
  await expect(source).toHaveAttribute("href", /^https:\/\//);
  const outgoing = page.getByRole("link", { name: `Visit ${chosen[0].brand}`, exact: true });
  const outgoingHref = await outgoing.getAttribute("href");
  expect(outgoingHref).toContain(`/api/outbound?product=${chosen[0].id}`);
  const redirect = await page.request.get(outgoingHref!, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe(await source.getAttribute("href"));

  await page.getByRole("button", { name: "Set a price target", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "A price that works for you." });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "Target price (USD)" }).fill("65.50");
  await dialog.getByRole("button", { name: "Save my target" }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Price watchlist/ }).click();
  await expect(page.getByRole("heading", { name: chosen[0].name, exact: true })).toBeVisible();
  await expect(page.getByText("$65.50", { exact: true })).toBeVisible();
  await expect(page.getByText("Not monitoring", { exact: true })).toBeVisible();
  await expect(page.getByText(/no alerts will be sent/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("$65.50", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("new searches recover after a brand filter and unsupported requests ask for clarification", async ({ page }) => {
  await home(page);
  await search(page, "Wireless headphones", "200");
  await page.getByRole("combobox", { name: "Filter by brand" }).selectOption("Sony");
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByRole("button", { name: "New search", exact: true }).click();
  const laptops = await search(page, "A laptop for work under $1,000");
  expect(laptops.products.length).toBeGreaterThan(0);
  await expect(page.getByRole("article")).toHaveCount(laptops.products.length);

  const unsupported = await search(page, "Find me a dishwasher under $600");
  expect(unsupported.products).toHaveLength(0);
  expect(unsupported.clarification).toBeTruthy();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "A little more detail would help." })).toBeVisible();
  await expect(page.getByText(unsupported.clarification!, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a new search", exact: true })).toBeVisible();
});

test("theme and privacy controls persist; desktop landing page renders without overflow", async ({ page }) => {
  await home(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await screenshot(page, "velora-desktop-home.png");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  const analytics = page.getByRole("switch", { name: "Optional usage analytics" });
  await expect(analytics).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(analytics).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("mobile navigation, discovery, and results fit the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await home(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await assertNoHorizontalOverflow(page);
  await screenshot(page, "velora-mobile-home.png");
  const menu = page.getByRole("button", { name: "Open navigation", exact: true });
  await expect(page.getByRole("navigation", { name: "Main navigation" })).not.toBeVisible();
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("navigation", { name: "Main navigation" })).not.toBeVisible();
  const data = await search(page, "Wireless headphones for travel", "200");
  expect(data.products.length).toBeGreaterThan(0);
  await expect(page.getByRole("article")).toHaveCount(data.products.length);
  await assertNoHorizontalOverflow(page);
  await page.getByRole("article").first().getByRole("button", { name: /^Save / }).click();
  await menu.click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: /Saved products/ }).click();
  await expect(page.getByRole("heading", { name: "Your shortlist." })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await assertNoHorizontalOverflow(page);
});
