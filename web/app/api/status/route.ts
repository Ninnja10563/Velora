import { authConfigured } from "../../../lib/auth.ts";
import { storageConfigured } from "../../../lib/storage.ts";
import { monitoringConfigured } from "../../../lib/alerts.ts";

/** Public capability labels contain no credentials and make no connectivity claims. */
export async function GET() {
  const provider = process.env.PRODUCT_PROVIDER || "demo";
  const assistant =
    process.env.AI_PROVIDER ||
    (process.env.AI_INTENT_ENDPOINT ? "http" : "local");
  return Response.json(
    {
      version: "0.2.0",
      products:
        provider === "demo"
          ? "Demonstration catalog"
          : provider === "ebay"
            ? "eBay Browse API selected"
            : provider === "feed"
              ? "Approved feed selected"
              : "Provider configuration invalid",
      assistant:
        assistant === "local"
          ? "Local shopping parser"
          : assistant === "openai"
            ? "OpenAI structured shopping tools selected"
            : assistant === "http"
              ? "HTTP intent service selected"
              : "Assistant configuration invalid",
      accounts:
        authConfigured() && storageConfigured()
          ? "Sign-in and account storage configured"
          : "Account services not fully configured",
      monitoring: monitoringConfigured()
        ? "Monitoring endpoint configured; an external scheduler is required"
        : "Monitoring is not configured",
      note: "Configuration labels do not confirm provider connectivity or successful scheduled checks.",
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
