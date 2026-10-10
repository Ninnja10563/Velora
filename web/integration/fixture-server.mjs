import { createServer } from "node:http";
import { randomUUID } from "node:crypto";

// Protocol fixtures only. These invented products, users, tokens, and messages
// never contact a retailer, identity provider, or email recipient.
const port = 54321;
let malformedFeed = false;
const users = new Map();
const states = new Map();
const alerts = new Map();
const notifications = new Map();
const histories = new Map();
const requests = [];
let sequence = 0;
const json = (response, status, body, headers = {}) => {
  response.writeHead(status, { "Content-Type": "application/json", ...headers });
  response.end(JSON.stringify(body));
};
function product(id, price) {
  const now = new Date().toISOString();
  const url = `https://retailer.example/products/${id}`;
  return {
    id, name: `Fixture wireless headphones ${id.endsWith("a") ? "A" : "B"}`, brand: "Protocol Fixture", category: "electronics",
    description: "Synthetic product used only to exercise the approved-feed protocol.",
    image: "/images/category-electronics.jpg", imageKind: "category", imageAlt: "Illustrative category image for an invented test product",
    price, currency: "USD", variant: "Fixture black / standard", model: id,
    specs: { Type: "Headphones", Connectivity: "Bluetooth" }, tags: ["headphones", "wireless", "studying"],
    pros: ["Fixture supports wireless listening"], cons: ["Synthetic test data; no purchase is possible"],
    offers: [{ id: `${id}-offer`, retailer: "Fixture retailer", price, currency: "USD", url, availability: "in_stock", lastChecked: now, status: "live", shipping: null, delivery: null }],
    source: { name: "Local protocol fixture — synthetic, not a live retailer", url, status: "live", lastChecked: now },
    rating: null, reviewCount: null, warranty: null, returnPolicy: null,
  };
}
function session(user) {
  return { access_token: `fixture-access-${user.id}`, refresh_token: `fixture-refresh-${user.id}`, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
}
function currentUser(request) {
  const token = request.headers.authorization?.replace(/^Bearer /, "");
  return [...users.values()].find(user => token === `fixture-access-${user.id}`);
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    let text = "";
    for await (const chunk of request) { text += chunk; if (text.length > 1_000_000) throw new Error("Fixture payload too large"); }
    const body = text ? JSON.parse(text) : {};
    requests.push({ method: request.method, path: url.pathname });
    if (url.pathname === "/__fixture/health") return json(response, 200, { fixture: true });
    if (url.pathname === "/__fixture/reset" && request.method === "POST") { users.clear(); states.clear(); alerts.clear(); notifications.clear(); histories.clear(); requests.length = 0; malformedFeed = false; sequence = 0; return json(response, 200, { fixture: true }); }
    if (url.pathname === "/__fixture/feed" && request.method === "POST") { malformedFeed = body.malformed === true; return json(response, 200, { fixture: true }); }
    if (url.pathname === "/__fixture/requests") return json(response, 200, { requests });
    if (url.pathname === "/products") {
      if (request.headers.authorization !== "Bearer fixture-feed-token") return json(response, 401, { error: "Fixture token required" });
      return json(response, 200, { products: malformedFeed ? [{ name: "Invalid fixture without provenance" }] : [product("fixture-headphones-a", 89), product("fixture-headphones-b", 129)] });
    }
    if (url.pathname === "/auth/v1/health") return json(response, 200, { name: "Fixture auth protocol" });
    if (url.pathname === "/auth/v1/signup") {
      const id = `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
      const user = { id, email: body.email, aud: "authenticated", role: "authenticated", email_confirmed_at: null, created_at: new Date().toISOString(), app_metadata: { provider: "email" }, user_metadata: {} };
      users.set(body.email, user);
      return json(response, 200, user);
    }
    if (url.pathname === "/auth/v1/verify") {
      const user = [...users.values()].find(user => body.token_hash === `fixture-confirm-${user.id}`);
      if (!user) return json(response, 403, { error_code: "otp_expired", msg: "Invalid fixture confirmation token" });
      user.email_confirmed_at = new Date().toISOString();
      return json(response, 200, session(user));
    }
    if (url.pathname === "/auth/v1/token") {
      const user = url.searchParams.get("grant_type") === "refresh_token"
        ? [...users.values()].find(user => body.refresh_token === `fixture-refresh-${user.id}`)
        : users.get(body.email);
      if (!user || !user.email_confirmed_at || (body.password && body.password !== "Fixture-password-123!")) return json(response, 400, { error_code: "invalid_credentials", msg: "Fixture credentials rejected" });
      return json(response, 200, session(user));
    }
    if (url.pathname === "/auth/v1/user") {
      const user = currentUser(request);
      return json(response, user ? 200 : 401, user || { error_code: "bad_jwt", msg: "Invalid fixture token" });
    }
    if (url.pathname === "/auth/v1/logout") { response.writeHead(204); return response.end(); }
    if (url.pathname.startsWith("/auth/v1/admin/users/") && request.method === "DELETE") {
      const id = url.pathname.split("/").at(-1);
      for (const [email, user] of users) if (user.id === id) users.delete(email);
      return json(response, 200, {});
    }
    if (url.pathname === "/auth/v1/recover") return json(response, 200, {});
    if (url.pathname === "/__fixture/users") return json(response, 200, { users: [...users.values()].map(user => ({ id: user.id, email: user.email, tokenHash: `fixture-confirm-${user.id}` })) });
    if (url.pathname.startsWith("/rest/v1/")) {
      if (request.headers.apikey !== "fixture-service-role") return json(response, 401, { error: "Fixture service key required" });
      const owner = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
      const id = (url.searchParams.get("id") || "").replace(/^eq\./, "");
      if (url.pathname === "/rest/v1/rpc/velora_create_price_alert") {
        const item = { id: randomUUID(), user_id: body.owner_id, product_id: body.product_snapshot.id, product_name: body.product_snapshot.name, variant_key: body.product_snapshot.variant, currency: body.product_snapshot.currency, target_price: body.target, enabled: true, revision: 1, last_price: null, last_checked_at: null, last_error: null, lease_token: null, created_at: new Date().toISOString() };
        alerts.set(item.id, item); return json(response, 200, item);
      }
      if (url.pathname === "/rest/v1/rpc/velora_update_price_alert") {
        const item = alerts.get(body.alert_id);
        if (!item || item.user_id !== body.owner_id) return json(response, 200, null);
        if (body.new_target !== null) item.target_price = body.new_target;
        if (body.new_enabled !== null) item.enabled = body.new_enabled;
        item.revision++; return json(response, 200, item);
      }
      if (url.pathname === "/rest/v1/price_alerts") {
        const items = [...alerts.values()].filter(item => item.user_id === owner && (!id || item.id === id));
        if (request.method === "DELETE") items.forEach(item => alerts.delete(item.id));
        return json(response, 200, items);
      }
      if (url.pathname === "/rest/v1/alert_notifications") {
        const items = [...notifications.values()].filter(item => item.user_id === owner && (!id || item.id === id));
        if (request.method === "PATCH") items.forEach(item => { item.read_at = body.read_at; });
        return json(response, 200, items);
      }
      if (url.pathname === "/rest/v1/rpc/velora_alert_history") {
        const item = alerts.get(body.alert_id);
        return json(response, 200, item?.user_id === body.owner_id ? histories.get(item.id) || [] : []);
      }
      if (url.pathname === "/rest/v1/rpc/velora_claim_price_alerts") {
        const items = [...alerts.values()].filter(item => item.enabled && !item.last_checked_at && !item.lease_token);
        items.forEach(item => { item.lease_token = randomUUID(); }); return json(response, 200, items);
      }
      if (url.pathname === "/rest/v1/rpc/velora_complete_price_alert") {
        const item = alerts.get(body.alert_id);
        if (!item || item.lease_token !== body.claim_token) return json(response, 200, { status: "lease_lost", notified: false });
        item.last_price = body.snapshot.price; item.last_checked_at = body.snapshot.checkedAt; item.lease_token = null;
        histories.set(item.id, [{ price: body.snapshot.price, currency: item.currency, checkedAt: body.snapshot.checkedAt, sourceUrl: body.snapshot.sourceUrl }]);
        const notified = body.snapshot.price <= item.target_price;
        if (notified) { const note = { id: randomUUID(), user_id: item.user_id, product_id: item.product_id, product_name: item.product_name, price: body.snapshot.price, target_price: item.target_price, currency: item.currency, created_at: new Date().toISOString(), read_at: null }; notifications.set(note.id, note); }
        return json(response, 200, { status: "checked", notified });
      }
      if (url.pathname === "/rest/v1/rpc/velora_fail_price_alert") return json(response, 200, true);
      if (url.pathname === "/rest/v1/user_state") {
        if (request.method === "POST") { states.set(body.user_id, body.state); response.writeHead(204); return response.end(); }
        const id = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");
        return json(response, 200, states.has(id) ? [{ state: states.get(id) }] : []);
      }
      if (url.pathname === "/rest/v1/profiles") {
        if (request.method === "DELETE") states.delete((url.searchParams.get("user_id") || "").replace(/^eq\./, ""));
        response.writeHead(204); return response.end();
      }
      return json(response, 200, []);
    }
    return json(response, 404, { error: "No fixture implements this protocol path" });
  } catch { return json(response, 400, { error: "Malformed fixture request" }); }
});
server.listen(port, "127.0.0.1", () => console.log(`Synthetic protocol fixtures listening on loopback port ${port}. No external services are contacted.`));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.close(() => process.exit(0)));
