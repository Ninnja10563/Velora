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

function parseDevelopmentOrigin(value) {
  if (typeof value !== "string" || !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?\/?$/.test(value)) return null;
  try { return new URL(value); } catch { return null; }
}

function createNavigationPolicy(config, runtime = {}) {
  const productionSite = parseHttpsUrl(config.siteUrl);
  if (!productionSite || productionSite.search || productionSite.hash || productionSite.pathname !== "/") throw new Error("The Velora site must be a public HTTPS origin.");
  let site = productionSite;
  if (runtime.developmentUrl) {
    if (runtime.isPackaged !== false || runtime.allowLocalhost !== true) throw new Error("Local development requires an unpackaged app and explicit loopback opt-in.");
    site = parseDevelopmentOrigin(runtime.developmentUrl);
    if (!site) throw new Error("The development URL must be an HTTP loopback origin, for example http://127.0.0.1:3000.");
  }
  const isDevelopment = site !== productionSite;
  function parseNavigationUrl(value) {
    const publicUrl = parseHttpsUrl(value);
    if (publicUrl || !isDevelopment || typeof value !== "string" || value.length > 8192) return publicUrl;
    try {
      const url = new URL(value);
      return !url.username && !url.password && url.origin === site.origin ? url : null;
    } catch { return null; }
  }
  const allowed = new Set([site.origin]);
  for (const origin of config.trustedAuthOrigins ?? []) {
    const parsed = parseHttpsUrl(origin);
    if (!parsed || parsed.origin !== origin) throw new Error("Authentication allowlist entries must be exact HTTPS origins.");
    allowed.add(parsed.origin);
  }
  return {
    siteOrigin: site.origin,
    isDevelopment,
    canNavigate(value) { const url = parseNavigationUrl(value); return Boolean(url && allowed.has(url.origin)); },
    isSite(value) { const url = parseNavigationUrl(value); return Boolean(url && url.origin === site.origin); },
    isOutbound(value) { const url = parseNavigationUrl(value); return Boolean(url && url.origin === site.origin && url.pathname === "/api/outbound" && url.searchParams.get("product")); },
    canDownloadExport(value, mimeType, filename) {
      if (typeof value !== "string" || mimeType !== "application/json" || filename !== "velora-my-data.json") return false;
      try {
        const blob = new URL(value);
        const source = parseNavigationUrl(blob.pathname);
        return blob.protocol === "blob:" && !blob.search && !blob.hash && Boolean(source && source.origin === site.origin);
      } catch { return false; }
    },
  };
}

module.exports = { parseHttpsUrl, parseDevelopmentOrigin, createNavigationPolicy };
