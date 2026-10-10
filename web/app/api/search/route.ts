import { searchProducts } from "../../../lib/search.ts";
import { enforceRateLimit, errorResponse, HttpError, readJson, sameOrigin, searchInputSchema } from "../../../lib/security.ts";
import { recordEvent } from "../../../lib/storage.ts";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) throw new HttpError("This request origin is not allowed.", 403);
    enforceRateLimit(request, "search", 30);
    const input = searchInputSchema.parse(await readJson(request));
    const result = await searchProducts(input);
    result.searchId = crypto.randomUUID();
    await recordEvent({ type: "search", category: result.intent.category, success: result.products.length > 0, consent: input.analyticsConsent === true, searchId: result.searchId });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
