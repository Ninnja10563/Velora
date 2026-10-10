import { products, categories } from "../../../lib/catalog.ts";
import { enforceRateLimit, errorResponse } from "../../../lib/security.ts";

export async function GET(request: Request) {
  try {
    enforceRateLimit(request, "catalog", 120);
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const product = products.find(product => product.id === id);
      if (!product) return Response.json({ error: "This product is not in our sample catalog." }, { status: 404 });
      return Response.json({ product, mode: "demo" }, { headers: { "Cache-Control": "public, max-age=300" } });
    }
    return Response.json({ products, categories, mode: "demo", lastChecked: null }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) { return errorResponse(error); }
}
