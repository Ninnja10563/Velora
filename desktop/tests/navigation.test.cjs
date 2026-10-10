"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createNavigationPolicy, parseHttpsUrl } = require("../navigation.cjs");
const config = require("../app-config.json");
const policy = createNavigationPolicy(config);

test("window navigation permits exact site and authentication origins only", () => {
  assert.equal(policy.canNavigate(`${config.siteUrl}/settings`), true);
  assert.equal(policy.canNavigate("https://auth.openai.com/authorize"), true);
  assert.equal(policy.canNavigate("https://auth.openai.com.attacker.example/authorize"), false);
  assert.equal(policy.canNavigate("https://retailer.example/product"), false);
  assert.equal(policy.canNavigate("file:///etc/passwd"), false);
});

test("external URLs reject executable protocols, credentials and private destinations", () => {
  assert.ok(parseHttpsUrl("https://retailer.example/product?tag=approved"));
  for (const value of ["javascript:alert(1)", "file:///tmp/evil", "http://retailer.example", "https://user:secret@retailer.example", "https://127.0.0.1", "https://localhost", "https://internal.local", "https://[::1]", "https://retailer.example:9000", null]) assert.equal(parseHttpsUrl(value), null);
});

test("only known first-party outbound route is eligible for authenticated resolution", () => {
  assert.equal(policy.isOutbound(`${config.siteUrl}/api/outbound?product=sony-wh1000xm5`), true);
  assert.equal(policy.isOutbound(`${config.siteUrl}/api/account?product=sony-wh1000xm5`), false);
  assert.equal(policy.isOutbound("https://attacker.example/api/outbound?product=p1"), false);
  assert.equal(policy.isOutbound(`${config.siteUrl}/api/outbound`), false);
});

test("configuration rejects insecure sites and wildcard authentication origins", () => {
  assert.throws(() => createNavigationPolicy({ siteUrl: "http://localhost:5173" }));
  assert.throws(() => createNavigationPolicy({ siteUrl: config.siteUrl, trustedAuthOrigins: ["https://auth.openai.com/path"] }));
});

test("development URL requires explicit opt-in and is impossible in packaged builds", () => {
  const developmentUrl = "http://127.0.0.1:3000";
  assert.throws(() => createNavigationPolicy(config, { developmentUrl, allowLocalhost: true, isPackaged: true }));
  assert.throws(() => createNavigationPolicy(config, { developmentUrl, isPackaged: false }));
  assert.throws(() => createNavigationPolicy(config, { developmentUrl, allowLocalhost: true }));
  for (const value of ["http://192.168.1.2:3000", "http://0.0.0.0:3000", "http://localhost.attacker.example:3000", "https://localhost:3000", "http://user@localhost:3000", "http://localhost:3000/path", "http://2130706433:3000", "file:///tmp/app"]) {
    assert.throws(() => createNavigationPolicy(config, { developmentUrl: value, allowLocalhost: true, isPackaged: false }));
  }
});

test("development navigation stays on the selected loopback origin and keeps external HTTPS rules", () => {
  const local = createNavigationPolicy(config, { developmentUrl: "http://127.0.0.1:3000", allowLocalhost: true, isPackaged: false });
  assert.equal(local.isDevelopment, true);
  assert.equal(local.canNavigate("http://127.0.0.1:3000/auth/confirm?token_hash=fixture"), true);
  assert.equal(local.isOutbound("http://127.0.0.1:3000/api/outbound?product=p1"), true);
  assert.equal(local.canNavigate("http://127.0.0.1:4318"), false);
  assert.equal(local.canNavigate("http://localhost:3000"), false);
  assert.equal(local.canNavigate(config.siteUrl), false);
  assert.equal(local.canNavigate("https://auth.openai.com/authorize"), true);
  assert.equal(local.canDownloadExport("blob:http://127.0.0.1:3000/id", "application/json", "velora-my-data.json"), true);
  assert.equal(parseHttpsUrl("http://127.0.0.1:3000"), null);
  assert.equal(policy.isDevelopment, false);
  assert.equal(config.siteUrl, "https://velora-shopping-finder.ninnja10563.chatgpt.site");
});

test("downloads permit only the first-party JSON data export blob", () => {
  const blob = `blob:${policy.siteOrigin}/127a0e99-e983-47d2-9f7c-136b1eacef2a`;
  assert.equal(policy.canDownloadExport(blob, "application/json", "velora-my-data.json"), true);
  assert.equal(policy.canDownloadExport(blob, "application/octet-stream", "velora-my-data.json"), false);
  assert.equal(policy.canDownloadExport(blob, "application/json", "velora-my-data.json.app"), false);
  assert.equal(policy.canDownloadExport("blob:https://attacker.example/id", "application/json", "velora-my-data.json"), false);
  assert.equal(policy.canDownloadExport(`${policy.siteOrigin}/download`, "application/json", "velora-my-data.json"), false);
  assert.equal(policy.canDownloadExport("data:application/json,{}", "application/json", "velora-my-data.json"), false);
  assert.equal(policy.canDownloadExport(`${blob}#fragment`, "application/json", "velora-my-data.json"), false);
});

test("preload forwards real outbound gestures and rejects synthetic events", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf8");
  const listeners = {};
  const messages = [];
  const window = { addEventListener: (name, listener) => { listeners[name] = listener; } };
  window.top = window;
  class Anchor { constructor(href) { this.href = href; } }
  vm.runInNewContext(source, {
    require: (name) => { assert.equal(name, "electron"); return { ipcRenderer: { send: (...args) => messages.push(args) } }; },
    process: { argv: [`--velora-site-origin=${policy.siteOrigin}`] },
    window, location: { origin: policy.siteOrigin }, HTMLAnchorElement: Anchor, URL,
  });
  function click(href, isTrusted = true) {
    const event = { isTrusted, button: 0, prevented: false, composedPath: () => [new Anchor(href)], preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
    listeners.click(event);
    return event;
  }
  assert.equal(click("https://retailer.example/product", false).prevented, false);
  assert.equal(messages.length, 0);
  assert.equal(click(`${policy.siteOrigin}/saved`).prevented, false);
  assert.equal(messages.length, 0);
  assert.equal(click("javascript:alert(1)").prevented, true);
  assert.equal(messages.length, 0);
  assert.equal(click("https://retailer.example/product").prevented, true);
  assert.deepEqual(messages[0], ["velora:link-gesture", "https://retailer.example/product"]);
  assert.equal(click(`${policy.siteOrigin}/api/outbound?product=p1`).prevented, true);
  assert.equal(messages.length, 2);
});

test("local preload relays only selected-origin outbound HTTP links", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "preload.cjs"), "utf8");
  const listeners = {};
  const messages = [];
  const window = { addEventListener: (name, listener) => { listeners[name] = listener; } };
  window.top = window;
  class Anchor { constructor(href) { this.href = href; } }
  vm.runInNewContext(source, {
    require: () => ({ ipcRenderer: { send: (...args) => messages.push(args) } }),
    process: { argv: ["--velora-site-origin=http://127.0.0.1:3000"] },
    window, location: { origin: "http://127.0.0.1:3000" }, HTMLAnchorElement: Anchor, URL,
  });
  const click = (href) => listeners.click({ isTrusted: true, button: 0, composedPath: () => [new Anchor(href)], preventDefault() {}, stopImmediatePropagation() {} });
  click("http://127.0.0.1:3000/api/outbound?product=fixture");
  click("http://retailer.example/product");
  click("http://127.0.0.1:54321/api/outbound?product=fixture");
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], ["velora:link-gesture", "http://127.0.0.1:3000/api/outbound?product=fixture"]);
});
