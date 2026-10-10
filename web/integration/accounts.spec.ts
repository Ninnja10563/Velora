import { expect, test, request as createRequest, type APIRequestContext } from "@playwright/test";

const baseURL = "http://127.0.0.1:3100";
const fixture = "http://127.0.0.1:54321";
const headers = { Origin: baseURL };
const password = "Fixture-password-123!";
const state = {
  savedProductIds: ["fixture-headphones-a"], comparisonProductIds: [], searchHistory: [],
  preferences: { currency: "USD", location: "", theme: "light", analyticsConsent: false },
};
async function register(context: APIRequestContext, email: string) {
  const signup = await context.post("/api/auth/signup", { headers, data: { email, password } });
  expect(signup.status(), await signup.text()).toBe(202);
  expect((await signup.json()).confirmationRequired).toBe(true);
  const users = await (await context.get(`${fixture}/__fixture/users`)).json();
  const user = users.users.find((entry: { email: string }) => entry.email === email);
  const confirmed = await context.post("/api/auth/verify", { headers, data: { tokenHash: user.tokenHash, type: "signup" } });
  expect(confirmed.status(), await confirmed.text()).toBe(200);
  const result = await confirmed.json();
  expect(result.access_token).toBeUndefined();
  const cookies = (await context.storageState()).cookies;
  expect(cookies.filter(cookie => cookie.name.startsWith("velora-")).every(cookie => cookie.httpOnly && cookie.sameSite === "Lax")).toBe(true);
  expect(cookies.some(cookie => cookie.name === "velora-access")).toBe(true);
  return result.user;
}

test.beforeEach(async ({ request }) => { await request.post(`${fixture}/__fixture/reset`); });

test("fixture confirmation issues private cookies and account ownership survives separate sessions", async ({ request }) => {
  const first = await register(request, "first@fixture.example");
  expect((await (await request.get("/api/auth/session")).json()).user.id).toBe(first.id);
  const saved = await request.put("/api/account", { headers, data: state });
  expect(saved.status(), await saved.text()).toBe(200);
  expect((await (await request.get("/api/account")).json()).state.savedProductIds).toEqual(["fixture-headphones-a"]);

  const second = await createRequest.newContext({ baseURL });
  try {
    await register(second, "second@fixture.example");
    const otherAccount = await (await second.get("/api/account")).json();
    expect(otherAccount.state).toBeNull();
    expect(otherAccount.user.id).not.toBe(first.id);
    const forged = await second.put("/api/account", { headers, data: { ...state, userId: first.id } });
    expect(forged.status()).toBe(400);
    const crossOrigin = await request.put("/api/account", { headers: { Origin: "https://attacker.example" }, data: state });
    expect(crossOrigin.status()).toBe(403);
    expect((await (await request.get("/api/account")).json()).state.savedProductIds).toEqual(["fixture-headphones-a"]);
  } finally { await second.dispose(); }

  const logout = await request.post("/api/auth/signout", { headers, data: {} });
  expect(logout.status()).toBe(200);
  expect((await (await request.get("/api/auth/session")).json()).user).toBeNull();
  const signIn = await request.post("/api/auth/signin", { headers, data: { email: "first@fixture.example", password } });
  expect(signIn.status()).toBe(200);
  expect((await (await request.get("/api/account")).json()).state.savedProductIds).toEqual(["fixture-headphones-a"]);
});

test("forged identity headers and invalid fixture credentials cannot authorize account data", async ({ request }) => {
  const guest = await request.get("/api/account", { headers: { "oai-authenticated-user-id": "attacker", "oai-authenticated-user-email": "attacker@fixture.example" } });
  expect((await guest.json()).authenticated).toBe(false);
  const rejected = await request.post("/api/auth/signin", { headers, data: { email: "unknown@fixture.example", password } });
  expect([400, 401]).toContain(rejected.status());
  expect((await request.storageState()).cookies.filter(cookie => cookie.name.startsWith("velora-"))).toHaveLength(0);
  expect((await request.put("/api/account", { headers, data: state })).status()).toBe(401);
});
