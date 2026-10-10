import type { Product, ProductOffer } from "./types.ts";

export function availableOfferPrice(offers: ProductOffer[], currency: string): number {
  const sameCurrency = offers.filter(offer => offer.currency === currency);
  const available = sameCurrency.filter(offer => offer.availability !== "out_of_stock");
  return Math.min(...(available.length ? available : sameCurrency).map(offer => offer.price));
}

/** Keep punctuation and configuration boundaries. Seller listings are not
 * equivalent products without manufacturer-verified variant identifiers. */
export function productIdentity(product: Product): string {
  if (product.id.startsWith("ebay_")) return product.id;
  const normalize = (value: string) => value.toLowerCase().normalize("NFKC").trim().replace(/\s+/g, " ");
  const specifications = Object.entries(product.specs).map(([key, value]) => [normalize(key), normalize(value)]).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([normalize(product.brand), normalize(product.model || product.name), normalize(product.variant), product.currency, specifications]);
}

export function deduplicateProducts(input: Product[]): Product[] {
  const byIdentity = new Map<string, Product>();
  for (const product of input) {
    const key = productIdentity(product);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, { ...product, price: availableOfferPrice(product.offers, product.currency), offers: [...product.offers] });
      continue;
    }
    const seen = new Set(existing.offers.map(offer => `${offer.retailer}:${offer.url}:${offer.currency}`));
    for (const offer of product.offers) {
      const offerKey = `${offer.retailer}:${offer.url}:${offer.currency}`;
      if (offer.currency === existing.currency && !seen.has(offerKey)) { existing.offers.push(offer); seen.add(offerKey); }
    }
    existing.price = availableOfferPrice(existing.offers, existing.currency);
  }
  return [...byIdentity.values()];
}
