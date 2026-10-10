import Link from "next/link";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { isAllowedAdmin } from "@/lib/account-validation";
import { getAnalyticsSummary, trustedIdentityEnabled, type AnalyticsSummary } from "@/lib/storage";

export const dynamic = "force-dynamic";

const box: React.CSSProperties = { border: "1px solid var(--line, #e5e7eb)", borderRadius: 16, padding: 24, background: "var(--surface, #fff)" };

function Breakdown({ title, rows }: { title: string; rows: { name: string; count: number }[] }) {
  return <section style={box}><h2 style={{ fontSize: 16, fontWeight: 650, marginBottom: 18 }}>{title}</h2>{rows.length ? <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}><thead><tr><th scope="col">Name</th><th scope="col" style={{ textAlign: "right" }}>Events</th></tr></thead><tbody>{rows.map((row) => <tr key={row.name}><td style={{ padding: "12px 0", overflowWrap: "anywhere" }}>{row.name}</td><td style={{ textAlign: "right" }}>{row.count.toLocaleString()}</td></tr>)}</tbody></table> : <p style={{ color: "var(--muted, #666)", fontSize: 14 }}>No consented events recorded yet.</p>}</section>;
}

export default async function AdminPage() {
  const user = trustedIdentityEnabled() ? await getChatGPTUser() : null;
  const authorized = Boolean(user && isAllowedAdmin(user.userId, process.env.ADMIN_USER_IDS));
  let summary: AnalyticsSummary | null = null;
  let unavailable = false;
  if (authorized) {
    try { summary = await getAnalyticsSummary(); } catch { unavailable = true; }
  }
  return <main style={{ minHeight: "100vh", maxWidth: 1120, padding: "40px 24px 80px", margin: "0 auto", color: "var(--text, #1d2527)" }}>
    <Link href="/" style={{ color: "var(--accent, #6a527a)", fontWeight: 600 }}>← Back to Velora</Link>
    <div style={{ margin: "40px 0 28px" }}><p style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "var(--muted, #666)" }}>Operations</p><h1 style={{ fontSize: "clamp(28px, 5vw, 40px)", letterSpacing: -1, margin: "8px 0" }}>Shopping, by the numbers.</h1><p style={{ color: "var(--muted, #666)", lineHeight: 1.6 }}>Recorded activity and integration status. Analytics include only requests with explicit visitor consent.</p></div>
    {!authorized && <section style={box}><h2 style={{ fontSize: 20, fontWeight: 600 }}>Administrator access required</h2><p style={{ margin: "12px 0 0", lineHeight: 1.7 }}>This page is restricted to the configured administrator allowlist. Shopping, comparisons, and your personal shortlist are available from the main app.</p></section>}
    {unavailable && <section style={box} role="alert"><h2>Analytics storage is unavailable</h2><p style={{ marginTop: 12 }}>No metrics have been substituted. Check the database configuration and applied migration, then refresh this page.</p></section>}
    {summary && <>
      <section style={{ ...box, marginBottom: 24, background: "var(--accent-soft, #ece5f0)" }}><strong>{summary.mode === "postgres" ? "PostgreSQL • last 30 days" : "Runtime-only analytics"}</strong><p style={{ fontSize: 14, lineHeight: 1.7, marginTop: 8 }}>{summary.mode === "runtime-only" ? `These are real events from this server instance, retained only until restart or eviction (maximum ${summary.runtimeLimit} events). They do not represent whole-site totals.` : "Metrics come from the configured PostgreSQL database. Clicks indicate outbound visits; they do not prove a purchase."} Since {new Date(summary.since).toLocaleString("en-US", { timeZone: "UTC" })} UTC.</p></section>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 16, marginBottom: 24 }}>
        {[{ label: "Product searches", value: summary.searchCount.toLocaleString() }, { label: "Outbound clicks", value: summary.outboundClickCount.toLocaleString() }, { label: "Searches with a click", value: summary.searchToClickRate === null ? "Unavailable" : `${(summary.searchToClickRate * 100).toFixed(1)}%` }, { label: "Failed searches", value: summary.failedSearchCount.toLocaleString() }].map((metric) => <section key={metric.label} style={box}><p style={{ fontSize: 13, color: "var(--muted, #666)" }}>{metric.label}</p><p style={{ fontSize: 30, fontWeight: 600, marginTop: 12 }}>{metric.value}</p></section>)}
      </div>
      <p style={{ fontSize: 13, color: "var(--muted, #666)", marginBottom: 24 }}>Search-to-click rate links a unique search ID to at least one outbound click. {summary.linkedSearchCount} searches have an ID; {summary.searchesWithClicks} led to a recorded click.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}><Breakdown title="Popular categories" rows={summary.popularCategories} /><Breakdown title="Products by outbound clicks" rows={summary.topProducts} /><Breakdown title="Retailers by outbound clicks" rows={summary.retailers} /></div>
      <section style={{ ...box, marginTop: 24 }}><h2 style={{ fontSize: 18, fontWeight: 650 }}>Conversions & commission</h2>{summary.conversionsConnected ? <><p style={{ marginTop: 12 }}>Confirmed network conversions: {summary.confirmedConversions?.toLocaleString()}</p><p style={{ marginTop: 8 }}>{summary.revenueByCurrency?.length ? summary.revenueByCurrency.map((row) => `${row.currency} ${row.amount.toFixed(2)}`).join(" · ") : "No confirmed commission recorded in this period."}</p></> : <p style={{ marginTop: 12, color: "var(--muted, #666)", lineHeight: 1.7 }}>Not connected. Outbound clicks are tracked separately; purchase confirmations and commission revenue are unavailable until a verified affiliate network integration is added.</p>}</section>
      <section style={{ ...box, marginTop: 24 }}><h2 style={{ fontSize: 18, fontWeight: 650 }}>Integration health</h2><dl style={{ display: "grid", gridTemplateColumns: "minmax(130px, 1fr) 2fr", gap: "14px 20px", marginTop: 20, lineHeight: 1.5 }}><dt>Account storage</dt><dd>{summary.mode === "postgres" ? "Connected; metrics query succeeded" : "Not configured"}</dd><dt>Product data</dt><dd>Inspect the source and checked timestamp on each product. Demo prices are illustrative.</dd><dt>Last analytics failure</dt><dd>{summary.lastAnalyticsWriteFailedAt ?? "None observed in this runtime"}</dd><dt>Price monitoring</dt><dd>No scheduled monitoring or notification delivery configured</dd></dl></section>
    </>}
  </main>;
}
