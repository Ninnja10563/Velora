import { HttpError } from "./security.ts";
import { fetchProviderJson, isAllowedProviderEndpoint } from "./provider-http.ts";
import { cachedProduct, productIdSchema, validateFeed } from "./product-validation.ts";
import { deduplicateProducts, productIdentity } from "./product-normalization.ts";
import type { Product, ProductProvider } from "./types.ts";

export class FeedProductProvider implements ProductProvider {
  readonly id = "approved-feed";
  get mode(): "live" | "unconfigured" { return this.configured() ? "live" : "unconfigured"; }
  private cache: { products: Product[]; expires: number } | undefined;
  private pending: Promise<Product[]> | undefined;
  private endpoint: string;
  private token: string | undefined;
  private hosts: string[];
  constructor() {
    this.endpoint = process.env.PRODUCT_FEED_URL || "";
    this.token = process.env.PRODUCT_FEED_TOKEN;
    this.hosts = (process.env.PRODUCT_RETAILER_HOSTS || "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
  }
  private configured(): boolean { return isAllowedProviderEndpoint(this.endpoint) && this.hosts.length > 0; }
  private async load(refresh = false): Promise<Product[]> {
    if (!this.configured()) throw new HttpError("The approved product feed is not configured. Set its URL and permitted retailer hosts.", 503);
    if (!refresh && this.cache && this.cache.expires > Date.now()) return this.cache.products.map(cachedProduct);
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const payload = await fetchProviderJson(this.endpoint, { headers: { Accept: "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) } });
      const products = validateFeed(payload, this.hosts);
      const seconds = Math.max(0, Math.min(3600, Number(process.env.PRODUCT_FEED_CACHE_SECONDS ?? "300") || 0));
      this.cache = { products, expires: Date.now() + seconds * 1000 };
      return products;
    })();
    try { return await this.pending; } finally { this.pending = undefined; }
  }
  async search(): Promise<Product[]> { return this.load(); }
  async getById(id: string, options?: { refresh?: boolean }): Promise<Product | null> {
    if (!productIdSchema.safeParse(id).success) return null;
    const catalog = await this.load(options?.refresh);
    const selected = catalog.find(product => product.id === id);
    if (!selected) return null;
    const merged = deduplicateProducts(catalog.filter(product => productIdentity(product) === productIdentity(selected)))[0];
    return { ...merged, id };
  }
  async health() {
    if (!this.configured()) return { available: false, detail: "Missing or invalid feed URL or retailer host allowlist." };
    try { const products = await this.load(); return { available: true, detail: `Validated feed accessible; ${products.length} products. Observation timestamps remain provider-supplied.` }; }
    catch { return { available: false, detail: "The feed could not be reached or failed validation." }; }
  }
}
