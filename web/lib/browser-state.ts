import { z } from "zod";
import { products } from "./catalog.ts";

// Browser storage is untrusted: old versions, manual edits and extensions can
// leave valid JSON with a shape the UI cannot safely use.
const catalogIds = new Set(products.map((product) => product.id));
const productId = z
  .string()
  .max(120)
  .refine((id) => catalogIds.has(id));
const amount = z.number().finite().positive().max(100_000);

const schemas: Record<string, z.ZodTypeAny> = {
  "velora-saved": z
    .array(productId)
    .max(100)
    .transform((ids) => [...new Set(ids)]),
  "velora-compare": z
    .array(productId)
    .max(4)
    .transform((ids) => [...new Set(ids)]),
  "velora-history": z
    .array(
      z
        .object({
          query: z.string().trim().min(1).max(1000),
          createdAt: z.string().datetime({ offset: true }),
          budget: amount.optional(),
        })
        .strict(),
    )
    .max(20),
  "velora-preferences": z
    .object({
      currency: z.enum(["USD", "AUD", "EUR", "GBP", "CAD"]),
      location: z.string().max(100),
      analyticsConsent: z.boolean(),
      theme: z.enum(["light", "dark"]),
    })
    .strict(),
  "velora-watchlist": z
    .array(
      z
        .object({
          id: productId,
          target: amount,
        })
        .strict(),
    )
    .max(100),
};

/** Returns validated state, or null so the caller can restore its safe default. */
export function validateBrowserState(
  key: string,
  value: unknown,
): unknown | null {
  if (!Object.prototype.hasOwnProperty.call(schemas, key)) return null;
  const result = schemas[key].safeParse(value);
  return result.success ? result.data : null;
}
