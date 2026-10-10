import { defineConfig } from "@playwright/test";

// An isolated local protocol harness, deliberately separate from live providers.
const baseURL = "http://127.0.0.1:3100";
export default defineConfig({
  testDir: "./integration", testMatch: "**/*.spec.ts", outputDir: "./outputs/integration-results",
  workers: 1, fullyParallel: false, timeout: 120_000, expect: { timeout: 15_000 }, retries: 0, reporter: "list",
  use: {
    baseURL, actionTimeout: 30_000, navigationTimeout: 60_000, trace: "retain-on-failure", screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
  },
  webServer: [
    { command: "node integration/fixture-server.mjs", url: "http://127.0.0.1:54321/__fixture/health", reuseExistingServer: false, timeout: 30_000 },
    {
      command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3100",
      url: baseURL, reuseExistingServer: false, timeout: 180_000,
      env: {
        APP_URL: baseURL, TRUST_SITES_IDENTITY: "false",
        SUPABASE_URL: "http://127.0.0.1:54321", ALLOW_LOCAL_SUPABASE: "true",
        SUPABASE_PUBLISHABLE_KEY: "fixture-publishable", SUPABASE_SERVICE_ROLE_KEY: "fixture-service-role",
        PRODUCT_PROVIDER: "feed", PRODUCT_FEED_URL: "http://127.0.0.1:54321/products", PRODUCT_FEED_TOKEN: "fixture-feed-token",
        PRODUCT_FEED_ALLOW_LOCALHOST: "true", PRODUCT_FEED_CACHE_SECONDS: "0", PRODUCT_RETAILER_HOSTS: "retailer.example",
        AI_PROVIDER: "local", AI_INTENT_ENDPOINT: "", AI_INTENT_API_KEY: "", OPENAI_API_KEY: "",
        CRON_SECRET: "fixture-cron-secret-do-not-use-in-production", ADMIN_USER_IDS: "", AFFILIATE_ALLOWED_HOSTS: "retailer.example",
        AFFILIATE_LINKS_JSON: JSON.stringify({ "fixture-headphones-a-offer": "https://retailer.example/products/fixture-headphones-a?fixture_attribution=approved-test" }),
        RESEND_API_KEY: "", SMTP_HOST: "", NOTIFICATION_PROVIDER: "disabled",
      },
    },
  ],
});
