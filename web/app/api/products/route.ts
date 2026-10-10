import { z } from "zod";
import { categories } from "../../../lib/catalog.ts";
import { deduplicateProducts, productProvider } from "../../../lib/providers.ts";
import { productIdSchema } from "../../../lib/product-validation.ts";
import { enforceRateLimit, errorResponse, HttpError } from "../../../lib/security.ts";
import { categoryIds } from "../../../lib/types.ts";

export async function GET(request: Request) {
  try {
    enforceRateLimit(request, "catalog", 120);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id) {
      if (!productIdSchema.safeParse(id).success) throw new HttpError("This product ID is invalid.", 400);
      const product = await productProvider.getById(id);
      if (!product) throw new HttpError("This product is no longer available from the selected provider.", 404);
      return Response.json({ product, mode: product.source.status, provider: productProvider.id }, { headers: { "Cache-Control": "no-store" } });
    }
    const currency = z.enum(["USD", "AUD", "GBP", "EUR", "CAD"]).parse(params.get("currency") || "USD");
    const category = params.has("category") ? z.enum(categoryIds).parse(params.get("category")) : undefined;
    const query = category ? categories.find(item => item.id === category)?.name || category : "";
    const products = deduplicateProducts(await productProvider.search({ query, category, currency })).filter(product => product.currency === currency && (!category || product.category === category));
    const mode = productProvider.mode === "demo" ? "demo" : products.length && products.every(product => product.source.status === "cached") ? "cached" : "live";
    return Response.json({ products, categories, mode, provider: productProvider.id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
