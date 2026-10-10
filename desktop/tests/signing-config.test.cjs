"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("missing optional signing secrets do not become a certificate path", () => {
  const keys = ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const filename = require.resolve("../electron-builder.cjs");
  try {
    for (const key of keys) process.env[key] = "";
    delete require.cache[filename];
    const config = require(filename);
    assert.equal(process.env.CSC_LINK, undefined);
    assert.equal(process.env.CSC_KEY_PASSWORD, undefined);
    assert.equal(config.mac.identity, "-");
    assert.equal(config.mac.hardenedRuntime, false);
    assert.equal(config.mac.notarize, false);

    process.env.CSC_LINK = "test-certificate.p12";
    process.env.CSC_KEY_PASSWORD = "test-value";
    delete require.cache[filename];
    const withCertificate = require(filename);
    assert.equal(process.env.CSC_LINK, "test-certificate.p12");
    assert.equal(process.env.CSC_KEY_PASSWORD, "test-value");
    assert.equal(withCertificate.mac.identity, undefined);
    assert.equal(withCertificate.mac.hardenedRuntime, true);
    assert.equal(withCertificate.mac.notarize, false);
  } finally {
    delete require.cache[filename];
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
