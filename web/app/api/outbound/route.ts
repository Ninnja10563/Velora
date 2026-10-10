import { productProvider } from "../../../lib/providers.ts";
import { productIdSchema } from "../../../lib/product-validation.ts";
import { enforceRateLimit, errorResponse, HttpError, resolveAffiliateUrl } from "../../../lib/security.ts";
import { recordEvent } from "../../../lib/storage.ts";

export async function GET(request: Request) {
  try {
    enforceRateLimit(request, "outbound", 60);
    const params = new URL(request.url).searchParams;
    const id = params.get("product");
    if (!productIdSchema.safeParse(id).success) throw new HttpError("This product link could not be found.", 404);
    const product = await productProvider.getById(id!);
    if (!product) throw new HttpError("This product link could not be found.", 404);
    const offer = params.has("offer") ? product.offers.find(offer => offer.id === params.get("offer")) : [...product.offers].filter(offer => offer.availability !== "out_of_stock").sort((a, b) => a.price - b.price)[0];
    if (!offer) throw new HttpError("This retailer offer could not be found.", 404);
    if (offer.availability === "out_of_stock") throw new HttpError("This offer is currently unavailable. Check other retailer offers.", 409);
    const configured = resolveAffiliateUrl(offer.id, offer.url);
    const destination = !configured.affiliate && productProvider.id === "ebay-browse" && process.env.EBAY_CAMPAIGN_ID && offer.affiliateUrl
      ? { url: offer.affiliateUrl, affiliate: true } : configured;
    const source = ["card", "detail", "comparison", "saved", "alert"].includes(params.get("source") || "") ? params.get("source")! : "other";
    const searchId = params.get("searchId") || undefined;
    await recordEvent({ type: "outbound_click", productId: product.id, retailer: offer.retailer, source, recommendationId: (params.get("recommendationId") || "").slice(0, 100) || undefined, searchId: searchId && /^[0-9a-f-]{36}$/i.test(searchId) ? searchId : undefined, consent: params.get("consent") === "true" });
    return new Response(null, { status: 302, headers: { Location: destination.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
  } catch (error) { return errorResponse(error); }
}
