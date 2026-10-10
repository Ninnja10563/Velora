import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

// Never echo status output: it contains the local service-role key.
let status;
try {
  status = JSON.parse(execFileSync("npx", ["--yes", "supabase@2.120.0", "status", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }));
} catch {
  console.error("Local Supabase is unavailable. Install/start Docker, then run npm run local:start (uses the pinned Supabase CLI).");
  process.exit(1);
}
const url = status.API_URL;
if (url !== "http://127.0.0.1:54321" || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  console.error("Expected local Supabase at http://127.0.0.1:54321 with local API keys. No file was written.");
  process.exit(1);
}
const values = {
  APP_URL: "http://127.0.0.1:3000",
  SUPABASE_URL: url,
  SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
  ALLOW_LOCAL_SUPABASE: "true",
  TRUST_SITES_IDENTITY: "false",
  PRODUCT_PROVIDER: "demo",
  AI_PROVIDER: "local",
  CRON_SECRET: randomBytes(32).toString("hex"),
};
try {
  writeFileSync(".env.local", "# Generated local credentials. Do not commit this file.\n" + Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
  console.log("Created ignored .env.local with local Supabase credentials. Existing files are never overwritten. Start npm run dev:local.");
} catch (error) {
  console.error(error.code === "EEXIST" ? ".env.local already exists; keep it or move it aside before regenerating. No values changed." : "Could not write .env.local.");
  process.exit(1);
}
