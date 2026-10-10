import { Buffer } from "node:buffer";
import { z } from "zod";
import { HttpError, isSafeExternalUrl } from "./security.ts";
import { fetchProviderJson } from "./provider-http.ts";
import { cachedProduct } from "./product-validation.ts";
import type { CategoryId, Product, ProductProvider, SearchInput } from "./types.ts";

// Official Browse API + OAuth client-credentials protocol. API roots are fixed;
// user input can supply search terms or opaque listing IDs, never a fetch URL.
const marketplaces = { USD: "EBAY_US", AUD: "EBAY_AU", GBP: "EBAY_GB", EUR: "EBAY_DE", CAD: "EBAY_CA" } as const;
const retailerHosts = ["www.ebay.com", "www.ebay.com.au", "www.ebay.co.uk", "www.ebay.de", "www.ebay.ca", "www.ebay.fr", "www.ebay.it", "www.ebay.es", "www.ebay.ie", "www.ebay.at", "www.ebay.ch", "www.sandbox.ebay.com"];
const amount = z.object({ value: z.string().regex(/^\d+(?:\.\d+)?$/), currency: z.string().regex(/^[A-Z]{3}$/) });
const itemSchema = z.object({
  itemId: z.string().max(80), title: z.string().min(1).max(1000), itemWebUrl: z.string().url(), price: amount,
  brand: z.string().max(200).optional(), mpn: z.string().max(200).optional(), shortDescription: z.string().max(10000).optional(), condition: z.string().max(200).optional(),
  image: z.object({ imageUrl: z.string().url() }).optional(), itemAffiliateWebUrl: z.string().url().optional(),
  localizedAspects: z.array(z.object({ name: z.string().max(100), value: z.string().max(1000) })).max(150).optional(),
  categoryPath: z.string().max(2000).optional(), categoryId: z.string().optional(), itemEndDate: z.string().optional(),
  estimatedAvailabilities: z.array(z.object({ estimatedAvailabilityStatus: z.string().optional() })).optional(),
  primaryProductReviewRating: z.object({ averageRating: z.string().optional(), reviewCount: z.number().int().nonnegative().optional() }).optional(),
  returnTerms: z.object({ returnsAccepted: z.boolean().optional(), returnPeriod: z.object({ value: z.number().optional(), unit: z.string().optional() }).optional(), returnShippingCostPayer: z.string().optional() }).optional(),
  shippingOptions: z.array(z.object({ shippingCost: amount.optional(), minEstimatedDeliveryDate: z.string().optional(), maxEstimatedDeliveryDate: z.string().optional() })).optional(),
  buyingOptions: z.array(z.string()).optional(), adultOnly: z.boolean().optional(),
});

const classifiers: { category: CategoryId; tag: string; match: RegExp }[] = [
  { category: "office", tag: "keyboard", match: /keyboards?/i },
  { category: "computers", tag: "tablet", match: /tablets?|\bipad/i },
  { category: "electronics", tag: "speaker", match: /speakers?/i },
  { category: "electronics", tag: "television", match: /televisions?|\btvs?\b/i },
  { category: "electronics", tag: "headphones", match: /headphones?|headset|earbuds?|earphones?|wh-?1000xm|wh-?ch720/i },
  { category: "computers", tag: "laptop", match: /laptops?|notebooks?|macbook|tuf gaming|\bloq\b/i },
  { category: "computers", tag: "monitor", match: /monitors?|g2724d|27up850/i },
  { category: "phones", tag: "phone", match: /smartphones?|\biphone\b|\bpixel\s?\d|\bgalaxy\s?[asz]\d/i },
  { category: "office", tag: "office chair", match: /office chair|desk chair|task chair/i },
  { category: "office", tag: "mouse", match: /\bmouse\b|\bmice\b/i },
  { category: "office", tag: "keyboard", match: /keyboards?/i },
  { category: "fitness", tag: "running shoes", match: /running shoes?|pegasus|gel.contend/i },
  { category: "fitness", tag: "yoga mat", match: /yoga mat/i },
  { category: "travel", tag: "backpack", match: /backpack|daypack|laptop bag/i },
  { category: "home", tag: "coffee maker", match: /coffee maker|aeropress|coffee brewer/i },
  { category: "home", tag: "kettle", match: /kettle/i },
  { category: "home", tag: "multicooker", match: /multicooker|instant pot|pressure cooker/i },
  { category: "beauty", tag: "cleanser", match: /cleanser|face wash/i },
  { category: "beauty", tag: "toothbrush", match: /toothbrush/i },
  { category: "fashion", tag: "jacket", match: /jacket|raincoat/i },
  { category: "fashion", tag: "shoes", match: /sneakers?|casual shoes?|stan smith/i },
  { category: "essentials", tag: "water bottle", match: /water bottle|nalgene|hydro flask/i },
];

export function ebayProductId(itemId: string, marketplace: string): string {
  return `ebay_${marketplace}_${Buffer.from(itemId, "utf8").toString("base64url")}`;
}

export function decodeEbayProductId(id: string): { itemId: string; marketplace: string } | null {
  const match = id.match(/^ebay_(EBAY_(?:US|AU|GB|DE|CA|FR|IT|ES|IE|AT|CH))_([a-zA-Z0-9_-]+)$/);
  if (!match || id.length > 120) return null;
  const itemId = Buffer.from(match[2], "base64url").toString("utf8");
  if (!/^v\d+\|[A-Za-z0-9_-]+\|[A-Za-z0-9_-]+$/.test(itemId) || ebayProductId(itemId, match[1]) !== id) return null;
  return { itemId, marketplace: match[1] };
}

export function normalizeEbayItem(raw: unknown, marketplace: string, affiliateEnabled = false): Product | null {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError("eBay returned an invalid product record.", 502);
  const item = parsed.data;
  if (item.adultOnly || (item.itemEndDate && Date.parse(item.itemEndDate) < Date.now()) || !item.buyingOptions?.includes("FIXED_PRICE")) return null;
  if (/\b(?:case|cover|replacement|earpads?|cushions?|cable|charger|stand|holder)\s+(?:for|compatible with)\b/i.test(item.title)) return null;
  if (!isSafeExternalUrl(item.itemWebUrl, retailerHosts)) throw new HttpError("eBay returned a product link outside its permitted hosts.", 502);
  const classification = classifiers.find(rule => rule.tag === "backpack" && rule.match.test(item.title)) || classifiers.find(rule => rule.match.test(item.title)) || classifiers.find(rule => rule.match.test(item.categoryPath || ""));
  if (!classification) return null;
  const id = ebayProductId(item.itemId, marketplace);
  if (!decodeEbayProductId(id)) throw new HttpError("eBay returned an invalid listing identifier.", 502);
  const specs = Object.fromEntries((item.localizedAspects || []).slice(0, 80).map(aspect => [aspect.name, aspect.value]));
  const aspect = (name: string) => Object.entries(specs).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const now = new Date().toISOString();
  const evidence = `${item.title} ${Object.entries(specs).filter(([, value]) => !/^(no|false|none|not applicable)$/i.test(value)).map(([key, value]) => `${key} ${value}`).join(" ")}`;
  const tags = [classification.tag];
  const features: [string, RegExp][] = [["wireless", /wireless|bluetooth/i], ["noise cancellation", /noise.cancell|\bANC\b/i], ["gaming", /gaming/i], ["4k", /\b4k\b|3840\s*[x×]\s*2160/i], ["usb-c", /usb[ -]?c/i], ["earbuds", /earbuds?|in.ear/i], ["android", /android/i], ["ios", /\bios\b|\biphone\b/i], ["windows", /windows/i], ["macos", /macos|macbook/i]];
  for (const [tag, pattern] of features) {
    const negated = new RegExp(`\\b(?:no|not|without)\\s+(?:${pattern.source})`, "i").test(evidence);
    if (pattern.test(evidence) && !negated) tags.push(tag);
  }
  const variantParts = [item.condition, aspect("Color"), aspect("Storage Capacity"), aspect("RAM Size"), aspect("Size")].filter(Boolean);
  const variant = variantParts.length ? variantParts.join(" · ") : `Listing ${item.itemId}; configuration not supplied`;
  const shipping = item.shippingOptions?.find(option => option.shippingCost?.currency === item.price.currency);
  const availability = item.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus;
  const ratingValue = Number(item.primaryProductReviewRating?.averageRating);
  const rating = Number.isFinite(ratingValue) && ratingValue >= 0 && ratingValue <= 5 ? ratingValue : null;
  const image = item.image?.imageUrl && isSafeExternalUrl(item.image.imageUrl) ? item.image.imageUrl : "/images/category-electronics.jpg";
  const affiliateUrl = affiliateEnabled && item.itemAffiliateWebUrl && isSafeExternalUrl(item.itemAffiliateWebUrl, [...retailerHosts, "rover.ebay.com"]) ? item.itemAffiliateWebUrl : undefined;
  const product: Product = {
    id, name: item.title, model: aspect("Model") || item.mpn || null, brand: item.brand || aspect("Brand") || "Not provided",
    category: classification.category, description: (item.shortDescription || "Details supplied by the eBay listing. Check the exact configuration and seller terms before buying.").replace(/<[^>]*>/g, "").slice(0, 3000),
    image, imageKind: item.image && image === item.image.imageUrl ? "product" : "category", imageAlt: item.image && image === item.image.imageUrl ? item.title : "Illustrative category photograph, not this listing",
    price: Number(item.price.value), currency: item.price.currency, variant,
    specs: { ...specs, ...(item.condition ? { Condition: item.condition } : {}), ...(aspect("Storage Capacity") ? { Storage: aspect("Storage Capacity")! } : {}), ...(aspect("RAM Size") ? { Memory: aspect("RAM Size")! } : {}) },
    tags, pros: [], cons: ["Seller-provided listing information; independent reliability has not been assessed."],
    offers: [{ id: `${id}_offer`, retailer: "eBay", price: Number(item.price.value), currency: item.price.currency, url: item.itemWebUrl, affiliateUrl, availability: availability === "IN_STOCK" ? "in_stock" : availability === "OUT_OF_STOCK" ? "out_of_stock" : "unknown", lastChecked: now, status: "live", shipping: shipping?.shippingCost ? Number(shipping.shippingCost.value) : null, delivery: shipping?.maxEstimatedDeliveryDate || null }],
    source: { name: "eBay Browse API · seller listing", url: item.itemWebUrl, status: "live", lastChecked: now },
    attributeSources: Object.fromEntries(["price", "availability", "specs", "rating"].map(key => [key, { url: item.itemWebUrl, lastChecked: now, kind: "retailer" as const }])),
    rating, reviewCount: item.primaryProductReviewRating?.reviewCount ?? null, warranty: null,
    returnPolicy: item.returnTerms?.returnsAccepted === true ? `Returns accepted${item.returnTerms.returnPeriod?.value ? ` within ${item.returnTerms.returnPeriod.value} ${item.returnTerms.returnPeriod.unit || "days"}` : ""}; check seller conditions.` : item.returnTerms?.returnsAccepted === false ? "Seller states returns are not accepted; statutory rights may still apply." : null,
  };
  if (!Number.isFinite(product.price) || product.price < 0 || product.price > 100000000) throw new HttpError("eBay returned an invalid price.", 502);
  return product;
}

export class EbayProductProvider implements ProductProvider {
  readonly id = "ebay-browse";
  get mode(): "demo" | "live" | "unconfigured" { return !this.configured() ? "unconfigured" : this.root.includes("sandbox") ? "demo" : "live"; }
  private token?: { value: string; expires: number };
  private tokenPromise?: Promise<string>;
  private items = new Map<string, { product: Product; expires: number }>();
  private readonly root = process.env.EBAY_ENVIRONMENT === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
  private configured() { return Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET && ["production", "sandbox"].includes(process.env.EBAY_ENVIRONMENT || "production")); }
  private async accessToken(): Promise<string> {
    if (!this.configured()) throw new HttpError("eBay Browse is selected but its application credentials are missing.", 503);
    if (this.token && this.token.expires > Date.now()) return this.token.value;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = (async () => {
      const data = await fetchProviderJson(`${this.root}/identity/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }).toString() }, 32000);
      const parsed = z.object({ access_token: z.string().min(1).max(12000), expires_in: z.number().positive().max(86400) }).safeParse(data);
      if (!parsed.success) throw new HttpError("eBay returned an invalid OAuth response.", 502);
      this.token = { value: parsed.data.access_token, expires: Date.now() + Math.max(1, parsed.data.expires_in - 60) * 1000 };
      return this.token.value;
    })();
    try { return await this.tokenPromise; } finally { this.tokenPromise = undefined; }
  }
  private async headers(marketplace: string): Promise<Record<string, string>> {
    const campaign = process.env.EBAY_CAMPAIGN_ID;
    if (campaign && !/^\d{10}$/.test(campaign)) throw new HttpError("The configured eBay Partner Network campaign ID is invalid.", 503);
    return { Authorization: `Bearer ${await this.accessToken()}`, "X-EBAY-C-MARKETPLACE-ID": marketplace, ...(campaign ? { "X-EBAY-C-ENDUSERCTX": `affiliateCampaignId=${campaign}` } : {}) };
  }
  async search(input: SearchInput): Promise<Product[]> {
    const marketplace = process.env.EBAY_MARKETPLACE_ID || marketplaces[(input.currency || "USD") as keyof typeof marketplaces] || "EBAY_US";
    if (!/^EBAY_(US|AU|GB|DE|CA|FR|IT|ES|IE|AT|CH)$/.test(marketplace)) throw new HttpError("The selected eBay marketplace is not supported by this adapter.", 503);
    const query = input.retrievalQuery || input.query.replace(/\b(find me|show me|i need|i want|the best|under\s*\$?\s*[\d,.]+)\b/gi, " ").trim() || process.env.EBAY_DISCOVERY_QUERY || "wireless headphones";
    const params = new URLSearchParams({ q: query.slice(0, 100), limit: "12", filter: `buyingOptions:{FIXED_PRICE}${input.budget ? `,price:[0..${input.budget}],priceCurrency:${input.currency || "USD"}` : ""}` });
    const data = await fetchProviderJson(`${this.root}/buy/browse/v1/item_summary/search?${params}`, { headers: await this.headers(marketplace) });
    const parsed = z.object({ itemSummaries: z.array(z.object({ itemId: z.string().max(80) })).max(50).optional() }).safeParse(data);
    if (!parsed.success) throw new HttpError("eBay returned an invalid search response.", 502);
    const summaries = parsed.data.itemSummaries || [];
    const found: Product[] = [];
    for (let index = 0; index < summaries.length; index += 4) {
      const chunk = await Promise.all(summaries.slice(index, index + 4).map(item => this.getById(ebayProductId(item.itemId, marketplace))));
      found.push(...chunk.filter((product): product is Product => product !== null));
    }
    return found;
  }
  async getById(id: string, options?: { refresh?: boolean }): Promise<Product | null> {
    const decoded = decodeEbayProductId(id);
    if (!decoded) return null;
    const existing = this.items.get(id);
    if (!options?.refresh && existing && existing.expires > Date.now()) return cachedProduct(existing.product);
    let raw: unknown;
    try { raw = await fetchProviderJson(`${this.root}/buy/browse/v1/item/${encodeURIComponent(decoded.itemId)}`, { headers: await this.headers(decoded.marketplace) }); }
    catch (error) { if (error instanceof HttpError && error.status === 404) { this.items.delete(id); return null; } throw error; }
    const product = normalizeEbayItem(raw, decoded.marketplace, Boolean(process.env.EBAY_CAMPAIGN_ID));
    if (product && this.root.includes("sandbox")) {
      product.source = { ...product.source, status: "demo", name: "eBay Sandbox · test listing, not a purchasable live offer" };
      product.offers = product.offers.map(offer => ({ ...offer, status: "demo", availability: "unknown", affiliateUrl: undefined }));
    }
    if (product && product.id !== id) throw new HttpError("eBay returned a different listing than requested.", 502);
    if (product) {
      if (this.items.size >= 500) this.items.delete(this.items.keys().next().value!);
      this.items.set(id, { product, expires: Date.now() + 60000 });
    }
    return product;
  }
  async health() {
    if (!this.configured()) return { available: false, detail: "eBay application credentials are missing." };
    try { await this.accessToken(); return { available: true, detail: "OAuth reachable. Browse permissions and marketplace availability are checked when requesting products." }; }
    catch { return { available: false, detail: "eBay OAuth unavailable or application credentials rejected." }; }
  }
}
