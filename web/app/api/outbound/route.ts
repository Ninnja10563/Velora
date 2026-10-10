import { products } from "../../../lib/catalog.ts";
import { enforceRateLimit, errorResponse, HttpError, resolveAffiliateUrl } from "../../../lib/security.ts";
import { recordEvent } from "../../../lib/storage.ts";

export async function GET(request: Request) {
  try {
    enforceRateLimit(request, "outbound", 60);
    const params = new URL(request.url).searchParams;
    const product = products.find(product => product.id === params.get("product"));
    if (!product) throw new HttpError("This product link could not be found.", 404);
    const offer = params.has("offer") ? product.offers.find(offer => offer.id === params.get("offer")) : product.offers[0];
    if (!offer) throw new HttpError("This retailer offer could not be found.", 404);
    const destination = resolveAffiliateUrl(offer.id, offer.url);
    const source = ["card", "detail", "comparison", "saved", "alert"].includes(params.get("source") || "") ? params.get("source")! : "other";
    const searchId = params.get("searchId") || undefined;
    await recordEvent({ type: "outbound_click", productId: product.id, retailer: offer.retailer, source, recommendationId: (params.get("recommendationId") || "").slice(0, 100) || undefined, searchId: searchId && /^[0-9a-f-]{36}$/i.test(searchId) ? searchId : undefined, consent: params.get("consent") === "true" });
    return new Response(null, { status: 302, headers: { Location: destination.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
  } catch (error) { return errorResponse(error); }
}
