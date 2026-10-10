import { HttpError, isSafeExternalUrl } from "./security.ts";

export function isAllowedProviderEndpoint(value: string): boolean {
  if (isSafeExternalUrl(value)) return true;
  if (process.env.NODE_ENV === "production" || process.env.PRODUCT_FEED_ALLOW_LOCALHOST !== "true") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password;
  } catch { return false; }
}

export async function fetchProviderJson(url: string, options: RequestInit = {}, maxBytes = 2_000_000): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: "no-store", redirect: "error", signal: options.signal || AbortSignal.timeout(12000) });
  } catch { throw new HttpError("The configured provider could not be reached. Please try again.", 503); }
  if (response.status === 404) throw new HttpError("This listing is no longer available from the provider.", 404);
  if (!response.ok) throw new HttpError(response.status === 429 ? "The provider is rate limited. Please try again later." : "The provider rejected the request. Check integration credentials and access.", 503);
  if (!response.body || Number(response.headers.get("content-length") || 0) > maxBytes) throw new HttpError("The provider returned an oversized or empty response.", 502);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new HttpError("The provider response exceeds the permitted size.", 502); }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError("The provider response was interrupted.", 503);
  } finally { reader.releaseLock(); }
  try { return JSON.parse(body); } catch { throw new HttpError("The provider returned invalid JSON.", 502); }
}
