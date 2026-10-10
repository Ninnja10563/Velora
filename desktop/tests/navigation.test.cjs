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
