import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseEnv } from "node:util";

const full = process.argv.includes("--full");
let failures = 0;
function check(label, ok, guidance, required = true) {
  console.log(`${ok ? "PASS" : required ? "FAIL" : "INFO"} ${label}${ok ? "" : ` — ${guidance}`}`);
  if (!ok && required) failures++;
}
function command(name, args) {
  const result = spawnSync(name, args, { encoding: "utf8", timeout: 12_000, stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0;
}
const [major, minor] = process.versions.node.split(".").map(Number);
check("Node.js >=22.13", major > 22 || (major === 22 && minor >= 13), "Install Node24 LTS.");
check("Locked dependencies installed", existsSync("node_modules/next/package.json") && existsSync("node_modules/@playwright/test/package.json"), "Run npm ci in web/.");
check("Supabase configuration", existsSync("supabase/config.toml"), "Run from web/.");
check("Supabase migrations", existsSync("supabase/migrations") && readdirSync("supabase/migrations").some(name => name.endsWith(".sql")), "The checked-in SQL migrations must be present.");
check("Docker daemon", command("docker", ["info", "--format", "{{.ServerVersion}}"]), "Install/start Docker for local accounts; demo and protocol fixtures work without it.", full);
check("Pinned CLI runner", command("npx", ["--version"]), "Install npm with Node; local:* downloads Supabase CLI 2.120.0 on first use.", full);
const env = { ...(existsSync(".env.local") ? parseEnv(readFileSync(".env.local", "utf8")) : {}), ...process.env };
check("Local environment", existsSync(".env.local"), "Optional for guest demo. After local:start, run npm run local:env.", full);
if (env.SUPABASE_URL) {
  const local = env.SUPABASE_URL === "http://127.0.0.1:54321";
  check("Supabase local opt-in", !local || env.ALLOW_LOCAL_SUPABASE === "true", "Set ALLOW_LOCAL_SUPABASE=true only for the local stack.");
  check("Supabase server credentials", Boolean(env.SUPABASE_SERVICE_ROLE_KEY && (env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY)), "Configure server-only keys; values are never printed here.");
  if (full && local) {
    try {
      const response = await fetch(`${env.SUPABASE_URL}/auth/v1/health`, { headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(5000) });
      check("Local auth service responds", response.ok, "Run npm run local:start.");
    } catch { check("Local auth service responds", false, "Run npm run local:start."); }
  }
}
const exposed = Object.keys(env).filter(key => key.startsWith("NEXT_PUBLIC_") && /(?:SECRET|SERVICE_ROLE|PRIVATE|TOKEN|PASSWORD)/i.test(key));
check("No secret-shaped public environment names", exposed.length === 0, "Move server credentials out of NEXT_PUBLIC_ variables.");
console.log(failures ? `${failures} required check(s) failed.` : "Required checks passed. Optional integrations are not represented as live.");
process.exitCode = failures ? 1 : 0;
