import { z } from "zod";
import { categoryIds, type Product } from "./types.ts";
import { availableOfferPrice } from "./product-normalization.ts";
import { HttpError, isSafeExternalUrl } from "./security.ts";

export const productIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const safeUrl = z.string().max(4096).refine(value => isSafeExternalUrl(value), "Only public HTTPS product URLs are accepted.");
const checkedAt = z.string().datetime({ offset: true }).refine(value => Date.parse(value) <= Date.now() + 300000, "Provider timestamps cannot be in the future.");
const price = z.number().finite().nonnegative().max(100000000);
const short = z.string().trim().min(1).max(500);
const offerSchema = z.object({
  id: productIdSchema, retailer: short, price, currency: z.string().regex(/^[A-Z]{3}$/), url: safeUrl,
  affiliateUrl: safeUrl.optional(), availability: z.enum(["unknown", "in_stock", "out_of_stock", "preorder"]),
  lastChecked: checkedAt, status: z.enum(["live", "cached"]).default("cached"),
  shipping: price.nullable().optional(), delivery: z.string().max(500).nullable().optional(),
}).strict();

/** The normalized feed is a factual contract. Missing evidence remains nullable. */
export const liveProductSchema = z.object({
  id: productIdSchema, name: short, brand: short, category: z.enum(categoryIds), description: z.string().max(3000),
  image: z.union([safeUrl, z.string().regex(/^\/images\/[a-zA-Z0-9_.-]+$/)]), imageKind: z.enum(["product", "category"]), imageAlt: z.string().max(500),
  price, currency: z.string().regex(/^[A-Z]{3}$/), variant: short, model: z.string().max(200).nullable().optional(),
  specs: z.record(z.string().max(100), z.string().max(1000)).refine(value => Object.keys(value).length <= 80),
  tags: z.array(z.string().trim().min(1).max(80)).max(80),
  pros: z.array(z.string().max(600)).max(12), cons: z.array(z.string().max(600)).max(12), offers: z.array(offerSchema).min(1).max(30),
  source: z.object({ name: short, url: safeUrl, status: z.enum(["live", "cached"]), lastChecked: checkedAt }).strict(),
  attributeSources: z.record(z.string().max(100), z.object({ url: safeUrl, lastChecked: checkedAt, kind: z.enum(["retailer", "manufacturer"]) }).strict()).optional(),
  rating: z.number().min(0).max(5).nullable(), reviewCount: z.number().int().nonnegative().nullable(),
  warranty: z.string().max(1000).nullable(), returnPolicy: z.string().max(1000).nullable(),
}).strict();

export function validateFeed(value: unknown, allowedHosts: string[]): Product[] {
  const result = z.object({ products: z.array(liveProductSchema).max(2000) }).strict().safeParse(value);
  if (!result.success) throw new HttpError("The product feed does not match the normalized product schema. No unvalidated results were used.", 502);
  const seen = new Set<string>();
  const maxLiveAge = Math.max(60, Math.min(3600, Number(process.env.PRODUCT_LIVE_MAX_AGE_SECONDS) || 300)) * 1000;
  return result.data.products.map(product => {
    if (seen.has(product.id)) throw new HttpError("The product feed contains duplicate product IDs.", 502);
    seen.add(product.id);
    const urls = [product.source.url, ...product.offers.map(offer => offer.url), ...Object.values(product.attributeSources || {}).map(source => source.url)];
    if (!urls.every(url => isSafeExternalUrl(url, allowedHosts))) throw new HttpError("The product feed contains a retailer outside the configured allowlist.", 502);
    if (product.offers.some(offer => offer.currency !== product.currency)) throw new HttpError("A product contains mixed-currency offers. Separate its currency variants.", 502);
    const offers = product.offers.map(offer => ({
      ...offer, affiliateUrl: undefined,
      status: offer.status === "live" && Date.now() - Date.parse(offer.lastChecked) <= maxLiveAge ? "live" as const : "cached" as const,
    }));
    // A provider-supplied affiliate URL is not an approved campaign by itself.
    // Operator-approved AFFILIATE_LINKS_JSON handles feed affiliate attribution.
    return {
      ...product, tags: [...new Set(product.tags.map(tag => tag.toLowerCase()))], offers,
      price: availableOfferPrice(offers, product.currency),
      source: { ...product.source, status: product.source.status === "live" && Date.now() - Date.parse(product.source.lastChecked) <= maxLiveAge ? "live" as const : "cached" as const },
    };
  });
}

export function cachedProduct(product: Product): Product {
  return { ...product, source: { ...product.source, status: product.source.status === "demo" ? "demo" : "cached" }, offers: product.offers.map(offer => ({ ...offer, status: product.source.status === "demo" ? "demo" : "cached" })) };
}
