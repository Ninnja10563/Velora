import { products } from "./catalog.ts";
import { HttpError } from "./security.ts";
import { FeedProductProvider } from "./feed-provider.ts";
import { EbayProductProvider } from "./ebay-provider.ts";
import type { Product, ProductProvider, SearchInput } from "./types.ts";
export { inferIntent, getAssistantMode } from "./ai-provider.ts";

export class DemoProductProvider implements ProductProvider {
  readonly id = "velora-demo";
  readonly mode = "demo" as const;
  async search(): Promise<Product[]> { return products; }
  async getById(id: string): Promise<Product | null> { return products.find(product => product.id === id) || null; }
  async health() { return { available: true, detail: "Explicit demonstration catalog; no live prices or stock checks." }; }
}
class UnavailableProvider implements ProductProvider {
  readonly id = "unconfigured";
  readonly mode = "unconfigured" as const;
  async search(): Promise<Product[]> { throw new HttpError("The selected product provider is not supported. Configure demo, feed, or ebay.", 503); }
  async getById(): Promise<Product | null> { throw new HttpError("The selected product provider is not supported.", 503); }
  async health() { return { available: false, detail: "Unsupported product provider setting." }; }
}
let current: { key: string; provider: ProductProvider } | undefined;
export function getProductProvider(): ProductProvider {
  const name = process.env.PRODUCT_PROVIDER || "demo";
  const key = JSON.stringify([name, process.env.PRODUCT_FEED_URL, process.env.PRODUCT_FEED_TOKEN, process.env.PRODUCT_RETAILER_HOSTS, process.env.EBAY_CLIENT_ID, process.env.EBAY_CLIENT_SECRET, process.env.EBAY_ENVIRONMENT, process.env.EBAY_CAMPAIGN_ID, process.env.PRODUCT_FEED_CACHE_SECONDS, process.env.PRODUCT_FEED_ALLOW_LOCALHOST]);
  if (current?.key === key) return current.provider;
  const provider = name === "demo" ? new DemoProductProvider() : name === "feed" ? new FeedProductProvider() : name === "ebay" ? new EbayProductProvider() : new UnavailableProvider();
  current = { key, provider };
  return provider;
}
/** Runtime facade, so changing environment config in tests never retains a wrong provider. */
export const productProvider: ProductProvider = {
  get id() { return getProductProvider().id; },
  get mode() { return getProductProvider().mode; },
  search(input: SearchInput) { return getProductProvider().search(input); },
  getById(id: string, options?: { refresh?: boolean }) { return getProductProvider().getById(id, options); },
  health() { return getProductProvider().health(); },
};

export { productIdentity, deduplicateProducts } from "./product-normalization.ts";
