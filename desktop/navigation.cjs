"use strict";

function parseHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    const host = url.hostname;
    if (!host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return null;
    return url;
  } catch { return null; }
}

function createNavigationPolicy(config) {
  const site = parseHttpsUrl(config.siteUrl);
  if (!site || site.search || site.hash || site.pathname !== "/") throw new Error("The Velora site must be a public HTTPS origin.");
  const allowed = new Set([site.origin]);
  for (const origin of config.trustedAuthOrigins ?? []) {
    const parsed = parseHttpsUrl(origin);
    if (!parsed || parsed.origin !== origin) throw new Error("Authentication allowlist entries must be exact HTTPS origins.");
    allowed.add(parsed.origin);
  }
  return {
    siteOrigin: site.origin,
    canNavigate(value) { const url = parseHttpsUrl(value); return Boolean(url && allowed.has(url.origin)); },
    isSite(value) { const url = parseHttpsUrl(value); return Boolean(url && url.origin === site.origin); },
    isOutbound(value) { const url = parseHttpsUrl(value); return Boolean(url && url.origin === site.origin && url.pathname === "/api/outbound" && url.searchParams.get("product")); },
    canDownloadExport(value, mimeType, filename) {
      if (typeof value !== "string" || mimeType !== "application/json" || filename !== "velora-my-data.json") return false;
      try {
        const blob = new URL(value);
        const source = parseHttpsUrl(blob.pathname);
        return blob.protocol === "blob:" && !blob.search && !blob.hash && Boolean(source && source.origin === site.origin);
      } catch { return false; }
    },
  };
}

module.exports = { parseHttpsUrl, createNavigationPolicy };
