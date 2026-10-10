import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL compiled to WASM. No database or network credentials are used.
// PGlite serializes statements; this verifies lease state transitions, not
// cross-process PostgreSQL SKIP LOCKED contention under production load.
const db = new PGlite();
const owner = "supabase:00000000-0000-4000-8000-000000000001";
const other = "supabase:00000000-0000-4000-8000-000000000002";
const product = { id: "fixture-headphones", name: "Synthetic SQL fixture headphones", variant: "Black / standard", currency: "USD" };
const query = (sql, params = []) => db.query(sql, params);
const scalar = async (sql, params = []) => Object.values((await query(sql, params)).rows[0])[0];
const createAlert = (target = 100, user = owner) => scalar("select public.velora_create_price_alert($1,$2::jsonb,$3) as alert", [user, JSON.stringify(product), target]);
const claim = async () => (await query("select * from public.velora_claim_price_alerts(20)")).rows;
function snapshot(price, checkedAt = new Date().toISOString(), changes = {}) {
  return { productId: product.id, variant: product.variant, price, currency: "USD", checkedAt, status: "live", availability: "in_stock", url: "https://retailer.example/item", sourceUrl: "https://retailer.example/item", offerId: "fixture-offer", retailer: "Fixture retailer", category: "electronics", brand: "Fixture", specs: { Type: "Headphones" }, ...changes };
}
const complete = (alert, observation) => scalar("select public.velora_complete_price_alert($1,$2,$3::jsonb)", [alert.id, alert.lease_token, JSON.stringify(observation)]);
async function due(id) { await query("update public.price_alerts set next_check_at=now()-interval '1 second' where id=$1", [id]); }

before(async () => {
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  const migrations = (await readdir(new URL("../../supabase/migrations/", import.meta.url))).filter(name => name.endsWith(".sql")).sort();
  assert.ok(migrations.length >= 2);
  for (const name of migrations) await db.exec(await readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
});
beforeEach(async () => {
  await db.exec("reset role; truncate public.profiles,public.products,public.search_events,public.outbound_clicks,public.confirmed_conversions cascade;");
  await query("insert into public.profiles(user_id) values($1),($2)", [owner, other]);
});
after(async () => { await db.close(); });

test("migrations install RLS and deny browser roles while allowing the service role", async () => {
  const tables = (await query("select relname,relrowsecurity from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relkind='r'")).rows;
  assert.ok(tables.length >= 11);
  assert.ok(tables.every(table => table.relrowsecurity));
  for (const role of ["anon", "authenticated"]) {
    assert.equal(await scalar("select has_table_privilege($1,'public.price_alerts','select')", [role]), false);
    assert.equal(await scalar("select has_function_privilege($1,'public.velora_claim_price_alerts(integer)','execute')", [role]), false);
    await db.exec(`set role ${role}`);
    await assert.rejects(query("select * from public.price_alerts"), /permission denied/);
    await assert.rejects(query("select * from public.velora_claim_price_alerts(20)"), /permission denied/);
    await db.exec("reset role");
  }
  await db.exec("set role service_role");
  assert.equal((await createAlert()).user_id, owner);
});

test("an active lease excludes another claim and an expired lease receives a new token", async () => {
  await createAlert();
  const [first] = await claim();
  assert.ok(first.lease_token);
  assert.equal((await claim()).length, 0);
  await query("update public.price_alerts set lease_until=now()-interval '1 second' where id=$1", [first.id]);
  const [reclaimed] = await claim();
  assert.notEqual(reclaimed.lease_token, first.lease_token);
  assert.deepEqual(await complete(first, snapshot(90)), { status: "lease_lost", notified: false });
  assert.deepEqual(await complete(reclaimed, snapshot(90)), { status: "checked", notified: true });
  assert.deepEqual(await complete(reclaimed, snapshot(90)), { status: "lease_lost", notified: false });
  assert.equal(await scalar("select count(*)::int from public.alert_notifications"), 1);
});

test("verified target crossings notify once and historical values remain real observations", async () => {
  const alert = await createAlert();
  const timestamp = Date.now() - 20_000;
  const results = [];
  for (const [index, price] of [90, 85, 120, 95].entries()) {
    await due(alert.id);
    const [leased] = await claim();
    results.push(await complete(leased, snapshot(price, new Date(timestamp + index * 1000).toISOString(), { sourceUrl: `https://retailer.example/check/${index}` })));
  }
  assert.deepEqual(results.map(result => result.notified), [true, false, false, true]);
  assert.equal(await scalar("select count(*)::int from public.price_observations"), 4);
  assert.equal(await scalar("select count(*)::int from public.alert_notifications"), 2);
  const history = await scalar("select public.velora_alert_history($1,$2)", [owner, alert.id]);
  assert.deepEqual(history.map(item => item.price), [95, 120, 85, 90]);
  assert.deepEqual(history.map(item => item.sourceUrl), [3, 2, 1, 0].map(index => `https://retailer.example/check/${index}`));
  assert.deepEqual(await scalar("select public.velora_alert_history($1,$2)", [other, alert.id]), []);
});

test("stale, cached, out-of-stock and mismatched variants cannot create observations", async () => {
  await createAlert();
  const [leased] = await claim();
  for (const invalid of [
    { status: "cached" }, { availability: "out_of_stock" }, { variant: "Different model" },
    { currency: "EUR" }, { checkedAt: new Date(Date.now() - 26 * 3600_000).toISOString() },
    { checkedAt: new Date(Date.now() + 3600_000).toISOString() }, { price: -1 },
  ]) await assert.rejects(complete(leased, snapshot(90, undefined, invalid)), /Invalid verified observation/);
  assert.equal(await scalar("select count(*)::int from public.price_observations"), 0);
  assert.equal(await scalar("select count(*)::int from public.alert_notifications"), 0);
});

test("owner updates invalidate outstanding claims and deleting an account cascades private data", async () => {
  const alert = await createAlert();
  const [leased] = await claim();
  assert.equal(await scalar("select public.velora_update_price_alert($1,$2,$3,$4)", [other, alert.id, 70, true]), null);
  const updated = await scalar("select public.velora_update_price_alert($1,$2,$3,$4)", [owner, alert.id, 70, true]);
  assert.equal(updated.revision, 2);
  assert.deepEqual(await complete(leased, snapshot(60)), { status: "lease_lost", notified: false });
  const [newLease] = await claim();
  assert.equal((await complete(newLease, snapshot(60))).notified, true);
  await query("insert into public.user_state(user_id,state) values($1,'{}')", [owner]);
  await query("delete from public.profiles where user_id=$1", [owner]);
  assert.equal(await scalar("select count(*)::int from public.user_state"), 0);
  assert.equal(await scalar("select count(*)::int from public.price_alerts"), 0);
  assert.equal(await scalar("select count(*)::int from public.alert_notifications"), 0);
  assert.equal(await scalar("select count(*)::int from public.price_observations"), 1);
});

test("monitor failures release only the matching lease and defer retries", async () => {
  await createAlert();
  const [leased] = await claim();
  assert.equal(await scalar("select public.velora_fail_price_alert($1,$2,$3)", [leased.id, "00000000-0000-4000-8000-999999999999", "Fixture outage"]), false);
  assert.equal(await scalar("select public.velora_fail_price_alert($1,$2,$3)", [leased.id, leased.lease_token, "Fixture outage"]), true);
  assert.equal((await claim()).length, 0);
  assert.equal(await scalar("select last_error from public.price_alerts where id=$1", [leased.id]), "Fixture outage");
});
