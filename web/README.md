# Velora web application

Velora turns a shopping request and budget into a shortlist with traceable product information. Version 0.2 adds configurable OpenAI interpretation, eBay Browse and approved feed retrieval, Supabase Auth and PostgreSQL accounts, durable price monitoring, and in-app notifications.

**Development-ready does not mean live-service verified.** The default hosted experience still uses clearly labeled demonstration products and the local parser. No external credentials, retailer approvals, production database, or Apple signing identity are bundled. The adapters are exercised with synthetic protocol fixtures; the database migrations run against real PostgreSQL through PGlite in tests. See [development setup](../docs/DEVELOPMENT.md) and [release readiness](../docs/READINESS.md) for the exact verification boundaries.

## Start locally

Node 24 is recommended. From the repository root:

```sh
cd web
npm ci
npm run doctor
npm run dev:local
```

Open `http://127.0.0.1:3000`. No keys are needed for guest shopping with the sample catalog. For real local accounts, install Docker, follow the Supabase steps in [DEVELOPMENT.md](../docs/DEVELOPMENT.md), then run:

```sh
npm run local:start
npm run local:env
npm run dev:local
```

`local:env` creates an ignored, permission-restricted `.env.local`; it refuses to overwrite an existing file or print keys. Local confirmation and recovery emails go to the Supabase development mail viewer. They are not sent to real inboxes. `local:reset` erases the local database; use it only when you intend to reset development data.

## Architecture

The UI uses React, TypeScript and the Next App Router programming model. Native Next development and production scripts support ordinary Node hosting. The existing Sites integration separately builds with Vinext/Vite into a Cloudflare Worker; the two build targets share application code. Provider, auth and database requests use HTTP so they work on both targets.

| Area | Implementation |
| --- | --- |
| UI, guest state, dynamic saved products | `components/`, `lib/browser-state.ts` |
| Product schema and provenance | `lib/types.ts`, `lib/product-validation.ts` |
| Product adapters | `lib/providers.ts`, `feed-provider.ts`, `ebay-provider.ts` |
| AI tool contract and transparent ranking | `lib/ai-provider.ts`, `lib/search.ts` |
| Authentication and session cookies | `lib/auth.ts`, `app/api/auth/` |
| Account workspace and analytics | `lib/storage.ts`, `app/api/account/`, `app/api/admin/` |
| Price alerts, observations, notifications | `lib/alerts.ts`, `database/price-alerts.sql` |
| Versioned PostgreSQL migrations | `supabase/migrations/` |
| Retailer and approved affiliate redirects | `app/api/outbound/route.ts` |
| Protected job invocation | `app/api/cron/price-alerts/`, `scripts/run-alert-job.mjs` |

## Configure real product data

Copy `.env.example` to an ignored environment file or configure server secrets in your host. Never use `NEXT_PUBLIC_` for credentials.

### eBay Browse

Set `PRODUCT_PROVIDER=ebay`, `EBAY_CLIENT_ID`, and `EBAY_CLIENT_SECRET`. Use credentials with approved Browse API access. The adapter obtains application OAuth tokens using client credentials, searches fixed-price listings, fetches listing details, and records observation timestamps. It skips adult-only, ended, unclassified, and certain accessory-only listings. It supports the explicitly documented categories in its classifier, not every eBay department.

Leave `EBAY_MARKETPLACE_ID` blank to select US, Australia, Great Britain, Germany or Canada from the search currency. Setting it forces a marketplace. `EBAY_ENVIRONMENT=sandbox` uses eBay's sandbox; its records are explicitly labeled demo and cannot create live price alerts. Sandbox responses do not establish production availability. `EBAY_DISCOVERY_QUERY` optionally chooses the initial discovery keywords (the default is wireless headphones). Location preferences are retained but do not currently supply buyer-specific shipping context; marketplace selection follows currency, and delivery estimates need retailer confirmation. Real purchases remain on eBay. Seller descriptions are treated as untrusted text; seller review data is not independent reliability evidence.

Each listing retains its own ID and variant. Different marketplace listings are not assumed to be identical merely because their titles look similar. Missing warranty, stock, reviews and specifications remain unavailable.

### Approved normalized product feed

Set `PRODUCT_PROVIDER=feed`, an HTTPS `PRODUCT_FEED_URL`, optional `PRODUCT_FEED_TOKEN`, and an exact comma-separated `PRODUCT_RETAILER_HOSTS` allowlist. Use a feed you are authorized to access. The endpoint returns `{ "products": [...] }` matching `liveProductSchema` in `lib/product-validation.ts`. That schema is the authoritative contract: IDs, variant, currency, source URL, original observation timestamp, offers, specifications and nullable evidence are validated before use. Include product-type tags such as `headphones`, `laptop`, or `vacuum cleaner`; only evidence-backed feature tags should be provided. `PRODUCT_LIVE_MAX_AGE_SECONDS` defaults to 300 (bounded between 60 and 3,600): older observations are labeled cached. Matching brand, model, variant, currency, and full specifications can merge retailer offers; conflicting configurations remain separate.

`PRODUCT_FEED_CACHE_SECONDS` controls the bounded in-memory cache. Cached records retain the feed's original timestamps and receive a cached label. Stale records never become live just because Velora fetched them recently. Provider failures return a useful error; selecting a real provider never silently swaps in demo products. The feed is capped at 2,000 records and 2 MB; larger catalogs need a paginated provider implementation. No unauthorized scraping is included.

Loopback HTTP feeds require `PRODUCT_FEED_ALLOW_LOCALHOST=true` in non-production development. That exception is rejected in production. Feed-supplied affiliate URLs are stripped; approval is configured separately.

## Configure AI

- `AI_PROVIDER=local`: deterministic natural-language rules, explicitly disclosed in results.
- `AI_PROVIDER=openai`: set `OPENAI_API_KEY` and a supported `OPENAI_MODEL`. The Responses API must produce a single strict `search_products` tool call. The server validates it, preserves original budget/model constraints, calls the selected product adapter, and ranks retrieved records. The model cannot invent a product, price, review, availability, destination URL or quality score. Selected OpenAI failures produce an error, not an undisclosed claim of AI processing.
- `AI_PROVIDER=http`: legacy vendor-neutral endpoint returning only category and priorities. An invalid/unavailable response produces a disclosed local-parser fallback with the selected product source unchanged.

Ranking orders supported user-priority matches, then price. Hard currency, budget, brand, category and supported specification constraints apply first. This is an explicit ordering method, not a numerical quality rating. Unsupported negative requirements and insufficient evidence lead to clarification instead of guessed recommendations. Listed prices exclude taxes and any shipping not explicitly provided; checkout totals must be confirmed with the retailer.

## Accounts and privacy

Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (or legacy `SUPABASE_ANON_KEY`), `SUPABASE_SERVICE_ROLE_KEY`, and `APP_URL`. Apply both versioned migrations. Configure the confirmation/recovery templates shown in [DEVELOPMENT.md](../docs/DEVELOPMENT.md); the `/auth/confirm` screen accepts a one-time token hash and clears it from browser history.

The server verifies users with Supabase Auth, stores access/refresh tokens in HttpOnly SameSite cookies, refreshes sessions on the server, and rejects cross-origin mutations. Cloud data is scoped to the verified account ID, never a caller-supplied owner. Direct browser SQL access is denied by grants and RLS. Auth requests and data responses are private/no-store. Email/password registration, confirmation, sign-in/out, recovery and account deletion are implemented. Configure real SMTP delivery and Supabase anti-abuse settings before opening registration publicly.

Guest saves, comparisons, history, targets and preferences remain in browser storage. Users explicitly sync or load their cloud workspace in Settings; there is no silent cross-device conflict resolution. Account deletion removes personal workspace data, alerts, notifications and the Supabase identity. Non-personal observed product prices and anonymous consented aggregate events can remain. Export and local deletion are available in Settings.

Optional `TRUST_SITES_IDENTITY=true` accepts identity only behind Sites' sanitizing dispatch. Never enable it on an ordinary public Next server. Admin access is an exact `ADMIN_USER_IDS` allowlist; Supabase identities use `supabase:<uuid>`.

## Scheduled prices and notifications

Creating an account alert requires a fresh in-stock offer from the selected live provider, PostgreSQL storage, and a random `CRON_SECRET` of at least 32 characters. Sample data cannot create live alerts. Guest targets are clearly marked as unmonitored.

An external scheduler must send `POST /api/cron/price-alerts` with `Authorization: Bearer <CRON_SECRET>`. A secret does not itself schedule anything. The included GitHub workflow runs daily at 03:17 UTC and can run manually. Configure repository variable `VELORA_ALERT_JOB_URL` and secret `VELORA_CRON_SECRET`. A private Site also needs the optional `VELORA_SITES_SERVICE_TOKEN` secret. The job runner refuses redirects to protect both credentials.

Each invocation claims up to 20 due alerts atomically. Configure a more frequent scheduler or repeated controlled invocations for a larger installation; the daily workflow is a small-development-installation default, not high-volume monitoring infrastructure. Failed checks retry on a later scheduled invocation. A minimum 15-minute due interval is enforced in SQL. Provider/API quotas still apply.

PostgreSQL leases prevent overlapping workers from processing the same alert concurrently. A transaction persists the verified observation and creates a notification only when the price enters the target range. Replays, stale observations, changed variants and mismatched currencies cannot create duplicate or misleading notifications. Users can pause, edit, delete, view real history and mark notifications read. Notifications are **in-app only**; email/push price notification delivery is not implemented.

## Affiliate links and analytics

Ordinary URLs and affiliate destinations remain separate. Approved full URLs can be mapped by offer ID in `AFFILIATE_LINKS_JSON`, with extra tracking hosts explicitly allowlisted in `AFFILIATE_ALLOWED_HOSTS`. For eBay Partner Network, configure your approved 10-digit `EBAY_CAMPAIGN_ID`; the official API returns the attributed destination. No campaign identifier or partnership is invented.

The outbound service resolves the provider record and validated offer, preserves configured attribution, and optionally records the source card/search. Commission rates never affect ranking. Click collection is off until the shopper opts in. The admin dashboard shows recorded events, not seeded business metrics. Without PostgreSQL, the small in-memory counters are explicitly runtime-only. Purchase/commission reporting remains unavailable unless a genuine network ingestion integration is implemented; this release does not include one.

## Checks and deployment

```sh
npm run typecheck
npm test
npm run test:db
npm run build:next
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:integration
```

Run browser suites sequentially. `test:integration` starts isolated local synthetic Auth/feed services, with no live credentials and no outgoing emails. The PGlite suite executes real PostgreSQL migrations and tests permissions, leases, atomic notifications, replay behavior and deletion cascades. Neither substitutes for a staging test against your actual Supabase, eBay and OpenAI accounts.

For native hosting, set server environment values, run `npm ci && npm run build:next`, then `npm run start:next` behind your HTTPS reverse proxy. For Sites, preserve `.openai/hosting.json` and the `sites()` Vite plugin; publish the Worker output with the Sites source/build helpers. SQL migrations and runtime secrets are separate from website publication.

Deployments with multiple replicas should apply distributed edge rate limits in addition to the per-process guards. Only enable `TRUST_PROXY` or `TRUST_CLOUDFLARE` when your edge overwrites the corresponding IP header. Configure backups, service quotas, log retention and provider health monitoring in staging before public launch. No secrets are logged by the included tooling.
