const endpoint = process.env.VELORA_ALERT_JOB_URL;
const secret = process.env.CRON_SECRET;
if (!endpoint || !secret) {
  console.log("Price monitoring skipped: VELORA_ALERT_JOB_URL and VELORA_CRON_SECRET must both be configured by the operator.");
  process.exit(0);
}
let url;
try { url = new URL(endpoint); } catch { throw new Error("Invalid alert job URL."); }
if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/api/cron/price-alerts" || url.search || url.hash || (url.port && url.port !== "443") || !url.hostname.includes(".") || url.hostname.endsWith(".local") || url.hostname.endsWith(".localhost") || /^\d+(\.\d+){3}$/.test(url.hostname) || url.hostname.includes(":")) {
  throw new Error("Alert job URL must be the exact public HTTPS /api/cron/price-alerts endpoint.");
}
const headers = { Authorization: `Bearer ${secret}`, Accept: "application/json" };
if (process.env.SITES_SERVICE_TOKEN) headers["OAI-Sites-Authorization"] = `Bearer ${process.env.SITES_SERVICE_TOKEN}`;
const response = await fetch(url, { method: "POST", headers, redirect: "error", signal: AbortSignal.timeout(90_000) });
if (!response.ok) throw new Error(`Price alert job returned HTTP ${response.status}. Check provider, storage, and job credentials.`);
const result = await response.json();
// Report aggregate outcomes only. Never print raw responses or recipient information.
const counts = Object.fromEntries(["claimed", "checked", "notified", "skipped", "failed"].map(key => [key, Number.isSafeInteger(result[key]) && result[key] >= 0 ? result[key] : null]));
console.log(JSON.stringify({ status: "completed", ...counts }));
if (counts.failed > 0) process.exitCode = 1;
