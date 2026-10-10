"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/types";

/** Browser state stores IDs, never trusted prices or retailer destinations. */
export function useCatalog(requiredIds: string[], currency = "USD") {
  const [products, setProducts] = useState<Product[]>([]);
  const [mode, setMode] = useState("loading");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const attempted = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
  const idsKey = [...new Set(requiredIds)].sort().join(",");
  const merge = useCallback((incoming: Product[]) => {
    setProducts((current) => {
      const byId = new Map(current.map((product) => [product.id, product]));
      for (const product of incoming) byId.set(product.id, product);
      return [...byId.values()];
    });
    setUnavailable((current) =>
      current.filter((id) => !incoming.some((product) => product.id === id)),
    );
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetch(`/api/products?currency=${encodeURIComponent(currency)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          error?: string;
          products?: Product[];
          product?: Product;
          mode?: string;
        };
        if (!response.ok)
          throw new Error(
            body.error || "Product data is unavailable. Try again shortly.",
          );
        merge(body.products || []);
        setMode(body.mode || "live");
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason.message);
          setMode("unavailable");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [merge, revision, currency]);

  useEffect(() => {
    const ids = idsKey
      .split(",")
      .filter(
        (id) =>
          id &&
          !products.some((product) => product.id === id) &&
          !attempted.current.has(id),
      );
    if (!ids.length || loading) return;
    const controller = new AbortController();
    async function retrieve() {
      // Bound concurrency for a large saved shortlist; never dispatch an unbounded fan-out.
      for (
        let offset = 0;
        offset < ids.length && !controller.signal.aborted;
        offset += 4
      ) {
        await Promise.all(
          ids.slice(offset, offset + 4).map(async (id) => {
            attempted.current.add(id);
            try {
              const response = await fetch(
                `/api/products?id=${encodeURIComponent(id)}`,
                { signal: controller.signal, cache: "no-store" },
              );
              const body = (await response.json()) as {
                error?: string;
                products?: Product[];
                product?: Product;
                mode?: string;
              };
              if (!response.ok || !body.product)
                throw new Error("Unavailable product");
              if (!controller.signal.aborted) merge([body.product]);
            } catch {
              if (controller.signal.aborted) attempted.current.delete(id);
              else setUnavailable((current) => [...new Set([...current, id])]);
            }
          }),
        );
      }
    }
    void retrieve();
    return () => controller.abort();
    // A completed request merges data; that must not abort the remaining batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, loading, revision, merge]);
  const retry = useCallback(() => {
    attempted.current.clear();
    setUnavailable([]);
    setRevision((value) => value + 1);
  }, []);
  return { products, mode, loading, error, unavailable, merge, retry };
}
