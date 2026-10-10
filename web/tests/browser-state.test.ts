import assert from "node:assert/strict";
import test from "node:test";
import { products } from "../lib/catalog.ts";
import { validateBrowserState } from "../lib/browser-state.ts";

const firstId = products[0].id;
const secondId = products[1].id;
const preferences = {
  currency: "USD",
  location: "United States",
  analyticsConsent: false,
  theme: "light",
};

test("browser shortlists accept safe retailer IDs and reject corrupt or unsafe records", () => {
  assert.deepEqual(
    validateBrowserState("velora-saved", [firstId, secondId, firstId]),
    [firstId, secondId],
  );
  assert.deepEqual(validateBrowserState("velora-saved", ["ebay_example-item"]), ["ebay_example-item"]);
  assert.deepEqual(validateBrowserState("velora-compare", [firstId]), [
    firstId,
  ]);
  for (const value of [
    null,
    "[]",
    {},
    [null],
    ["../unsafe-product"],
    [firstId, { id: secondId }],
  ]) {
    assert.equal(validateBrowserState("velora-saved", value), null);
  }
  assert.equal(
    validateBrowserState("velora-saved", Array(101).fill(firstId)),
    null,
  );
  assert.equal(
    validateBrowserState("velora-compare", Array(5).fill(firstId)),
    null,
  );
});

test("browser search history accepts valid records and rejects invalid dates or budgets", () => {
  const history = [
    {
      query: "Travel headphones",
      createdAt: "2026-10-10T10:00:00.000Z",
      budget: 200,
    },
  ];
  assert.deepEqual(validateBrowserState("velora-history", history), history);
  assert.deepEqual(
    validateBrowserState("velora-history", [
      { query: "Coffee maker", createdAt: "2026-10-10T10:00:00+10:00" },
    ]),
    [{ query: "Coffee maker", createdAt: "2026-10-10T10:00:00+10:00" }],
  );
  for (const patch of [
    { createdAt: "yesterday" },
    { createdAt: "2026-02-30T00:00:00Z" },
    { budget: -1 },
    { budget: Infinity },
    { budget: 100001 },
    { budget: "200" },
    { query: " " },
    { query: "x".repeat(1001) },
  ]) {
    assert.equal(
      validateBrowserState("velora-history", [{ ...history[0], ...patch }]),
      null,
    );
  }
  assert.equal(
    validateBrowserState("velora-history", Array(21).fill(history[0])),
    null,
  );
});

test("browser preferences never coerce malformed consent or currency", () => {
  assert.deepEqual(
    validateBrowserState("velora-preferences", preferences),
    preferences,
  );
  for (const patch of [
    { analyticsConsent: "false" },
    { analyticsConsent: 1 },
    { currency: "XYZ" },
    { theme: "system" },
    { location: "x".repeat(101) },
    { userId: "someone-else" },
  ]) {
    assert.equal(
      validateBrowserState("velora-preferences", { ...preferences, ...patch }),
      null,
    );
  }
  assert.equal(
    validateBrowserState("velora-preferences", { currency: "USD" }),
    null,
  );
});

test("browser watchlists require safe product identifiers and finite positive target prices", () => {
  assert.deepEqual(
    validateBrowserState("velora-watchlist", [{ id: firstId, target: 99.95 }]),
    [{ id: firstId, target: 99.95 }],
  );
  for (const target of [0, -5, NaN, Infinity, 100001, "99.95", null]) {
    assert.equal(
      validateBrowserState("velora-watchlist", [{ id: firstId, target }]),
      null,
    );
  }
  assert.equal(
    validateBrowserState("velora-watchlist", [{ id: "https://unsafe.test/item", target: 100 }]),
    null,
  );
  assert.equal(
    validateBrowserState(
      "velora-watchlist",
      Array(101).fill({ id: firstId, target: 100 }),
    ),
    null,
  );
});

test("unrecognized browser storage keys and inherited object keys are rejected", () => {
  for (const key of ["unknown", "constructor", "toString", "__proto__"])
    assert.equal(validateBrowserState(key, preferences), null);
  assert.deepEqual(validateBrowserState("velora-history", []), []);
  assert.deepEqual(validateBrowserState("velora-watchlist", []), []);
});
