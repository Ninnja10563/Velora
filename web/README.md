# Velora

A shopping assistant for people who want a short, understandable product shortlist within a firm budget. The app combines a conversational search experience, transparent recommendations, product comparisons, browser shortlists, and an affiliate-ready outbound link service.

The default application uses an explicitly labeled demonstration catalog. Its USD prices and specifications are illustrative, stock and review information are unknown, and manufacturer links are references rather than proof that a current offer exists. No live retailer partnership, independent product testing, affiliate commission, account synchronization, or notification delivery is claimed without the corresponding integration.

## Product scope

The first release serves individual shoppers researching electronics, computers, phones, home products, fitness, office equipment, travel, personal care, clothing, and daily essentials. The main journey is request → budget and priorities → explained shortlist → compare → visit the source. Guests can shop immediately.

Included functionality:

- Natural-language shopping search with budget and category extraction, clarification for broad requests, and structured product recommendations.
- Hard budget filtering, brand and category filtering, deterministic ranking with readable explanations, and useful empty states.
- Comparison and detail views with specifications, trade-offs, source information, and the data limitations shown alongside prices.
- Browser-local saved products, preferences, comparison selections, search history, and price target lists. Browser data can be removed in Settings.
- Light/dark appearance, keyboard-accessible controls, responsive layouts, and loading/error states.
- Validated outbound source links, optional approved affiliate attribution, and consent-controlled outbound click analytics.
- Optional PostgreSQL account storage and an authorized administrator dashboard.

Price targets are a local watchlist. There is no recurring price fetch, historical chart without observations, push/email delivery, verified review analysis, or purchase confirmation integration in this release. Choosing a display currency does not invent exchange rates or turn a USD sample offer into a local offer.

## Stack and source layout

The source uses the Next.js App Router programming model, React, TypeScript, and Tailwind. The supplied Sites integration builds it with Vinext/Vite into a Cloudflare Worker. This is a Next-compatible application running on Vinext; the delivered artifact is not a standard `next build` output.

| Area | Location |
| --- | --- |
| Shopping interface and routes | `app/`, `components/` |
| Product types and sample catalog | `lib/types.ts`, `lib/catalog.ts` |
| Retrieval, intent interpretation and ranking | `lib/` and `app/api/search/` |
| Outbound retailer/affiliate routing | `app/api/outbound/` and `lib/` |
| Account validation and authorization helpers | `lib/account-validation.ts` |
| PostgreSQL HTTP adapter and consented analytics | `lib/storage.ts` |
| Account API | `app/api/account/route.ts` |
| Administrator API and dashboard | `app/api/admin/route.ts`, `app/admin/page.tsx` |
| Database migration | `database/schema.sql` |
| Essential behavior and security tests | `tests/` |

The PostgreSQL adapter uses Supabase's HTTPS REST endpoint so it works in the Worker runtime, which does not support raw PostgreSQL TCP connections. SQL is deliberately separate from deployment: publishing the app does not apply this migration or provision a database.

## Local development

Use Node.js 24 for the native TypeScript test runner; the starter supports Node.js 22.13+ for ordinary development.

```sh
cd web
npm run install:ci
npm run dev
```

When already inside `web`, omit `cd web`. Run only one dependency installer at a time. The portable preview normally starts at `http://localhost:5173`; use the address reported by the process. The ignored `.sites-runtime/execution-profile.json` selects the local or managed runtime. Preserve the starter's `sites()` Vite plugin and build scripts.

No external credentials are needed for the demo experience. Copy `.env.example` to an ignored local environment file when configuring optional services. Do not place secret values in source, the hosting manifest, client components, screenshots, or any `NEXT_PUBLIC_` variable.

```sh
npx tsc --noEmit
node --experimental-strip-types --test tests/*.test.ts
npm run test:e2e
npm run build
npm start
```

`npm start` previews the built Worker locally via Wrangler. It does not publish the application. It also does not provide production sign-in by itself.

The Sites portable development server can simulate ChatGPT sign-in at `/signin-with-chatgpt?return_to=/`. Its `local_seedy` identity is strictly a local development identity and is always denied access to the administrator dashboard.

## Identity and account storage

Hosted Sites owns authentication and injects validated identity headers. Velora reads identity through the supplied `getChatGPTUser()` helper and uses the Site-scoped stable user ID as the owner of each account row. Display names are rendered as text; email addresses are not persisted by this application.

To enable account sync:

1. Create a Supabase PostgreSQL project and apply `database/schema.sql` using an authorized migration role. The schema assumes Supabase's standard `anon`, `authenticated`, and `service_role` database roles.
2. Set `SUPABASE_URL` to its HTTPS project origin and configure `SUPABASE_SERVICE_ROLE_KEY` as a server secret.
3. Set `TRUST_SITES_IDENTITY=true` only on a host behind Sites' trusted identity-injecting dispatch. Keep it false for any standalone deployment where visitors could send their own `oai-authenticated-user-*` headers.
4. Sign in through a normal top-level anchor to `/signin-with-chatgpt?return_to=/settings`. Sign-in is owned by the hosting platform and must not be implemented as a browser fetch or a custom OAuth endpoint.

Without trusted identity or database credentials, the app remains a guest experience. An authenticated request without configured storage receives an explicit `503` for unavailable sync. There is no in-memory substitute for user accounts.

`GET /api/account` returns account availability and optional stored state. `PUT /api/account` validates and replaces the signed-in user's state. It never accepts a user ID from the browser. State supports at most 100 saved product IDs, 4 comparison IDs, 50 searches, and bounded preferences. Mutation requests require the same origin, a bounded streamed body, and a per-user runtime rate limit. Concurrent account writes use last-write-wins semantics; add revisions if multi-device editing becomes frequent.

`DELETE /api/account` deletes the current user's profile and cascades deletion to stored app state. This deletes Velora's data only, not the user's ChatGPT identity. Browser data is a separate copy and must also be cleared. Analytics events do not contain account IDs, email addresses, IP addresses, or raw search text; deleting an account does not remove already anonymous aggregates. Review host logs and external provider retention separately when enabling services.

Every table has row-level security enabled with no public policies. Direct anonymous/authenticated table access is revoked. The server uses the service-role key and performs explicit user scoping. Never expose that key to the browser. Grant only necessary access to operations staff and configure database backups and retention before public production use.

## Analytics and administrator access

Analytics are off unless a request carries explicit visitor consent. `recordEvent` accepts only search and outbound click events and a bounded set of dimensions. Search IDs link a search to an outbound click; an outbound visit never counts as a purchase.

Set `ADMIN_USER_IDS` to a comma-separated list of exact trusted Sites user IDs. An empty list denies everyone. The administrator page at `/admin` and its JSON API enforce this allowlist on the server. The local starter identity is denied even if someone adds it to the allowlist.

With PostgreSQL configured, metrics cover the last 30 days and come from the `velora_admin_metrics` SQL function. Without PostgreSQL, consenting events are held in a maximum 1,000-event runtime buffer. The dashboard labels that data as runtime-only: it resets when the Worker restarts, differs across instances, and is not whole-site analytics. A database outage is reported rather than replaced with invented data.

The dashboard displays actual recorded searches, failures, outbound visits, popular categories, products, retailers, and a search-to-click rate when linked search IDs exist. Confirmed affiliate conversions and commissions remain unavailable by default. `AFFILIATE_CONVERSIONS_ENABLED` must stay false until a network-verified ingestion service exists; toggling it alone does not establish one. The schema's conversion table is infrastructure for that future service and contains no seeded revenue.

Before scaling, replace runtime rate limits with edge/distributed enforcement, add centralized operational error monitoring, configure consent retention, and schedule database retention policies. The current runtime limit is a bounded backstop, not a distributed abuse-prevention service.

## Data quality and extension contracts

The default intent parser runs locally on the server. Optional `AI_INTENT_ENDPOINT` accepts a public HTTPS endpoint for an LLM-backed structured intent service; `AI_INTENT_API_KEY` is an optional server-only bearer token. The service receives `{ task: "shopping_intent", input: { query, priorities }, instructions, allowedCategories }` and must return `{ category?: CategoryId, priorities?: string[] }`. Responses are validated and bounded; a failure falls back to the local parser. This service interprets the request only and cannot manufacture product facts. No OpenAI account or key is provisioned automatically. Review the service's privacy terms before sending shopper queries to it.

`AFFILIATE_LINKS_JSON` maps known offer IDs to full approved affiliate URLs. `AFFILIATE_ALLOWED_HOSTS` is a comma-separated list of additional exact tracking hosts; the ordinary retailer's host is already permitted. Leave both unconfigured until the corresponding program approves the publisher and supplies valid attribution. An absent affiliate mapping sends the shopper to the ordinary source URL. The app never fabricates a tracking ID or claims a qualifying purchase. Configure `TRUST_PROXY=true` only if your trusted edge overwrites `X-Forwarded-For`; otherwise rate limiting does not trust that caller-controlled header.

External providers must use approved APIs, contracted feeds, or another permitted data source. The `ProductProvider` interface is an extension seam, not a completed live adapter. To connect a real feed, widen demo-only status/timestamp types, replace the client’s catalog lookup with provider-backed product retrieval, and update demo-specific ranking/currency messages. Implement the interface only with verified source data; do not use an LLM as a product database. Normalize brand, model, region, configuration and variant before matching the same item between stores. Never collapse a different storage size, generation, color-dependent offer, or hardware configuration into a claimed identical product.

Preserve an ordinary source URL separately from any affiliate URL. A production offer needs its currency, price source, retrieval timestamp, data status, retailer listing ID, availability evidence, and variant. Attribute-level provenance can be stored in `products.attribute_sources`; offer snapshots can be stored in `price_observations`. The migration supplies these structures but the demo adapter does not populate a live historical database.

Unknown ratings, review counts, availability, warranty, return terms and source timestamps remain unknown. A manufacturer reference is not verification of the example catalog's price. Product and category imagery must remain labeled appropriately when it illustrates a category rather than the precise listed model.

Recommendation ranking is based on the request, budget and catalog facts. Affiliate configuration must never alter ranking. Customer ratings, reliability claims, review summaries and price savings must not be inferred from missing data. Do not publish numerical quality scores without sufficient evidence and a disclosed method.

## Sites deployment

The source manifest `.openai/hosting.json` holds the Site ID and declares bindings; it must not contain credentials. New Sites are private by default. The owner publishing workflow should retain this audience unless explicitly changed.

When using the Sites plugin, use its supported project setup, source synchronization, build, packaging and native deployment tools. The framework build command is `node <sites-plugin-root>/scripts/build-site.mjs`. The source helper owns commit/push and packaging; pass its verified project ID, commit SHA and archive to the deployment tool. Configure runtime secrets through the host's secret manager. Deployment success must be established from the native returned status and URL, not assumed from a passing local build.

For another host, port or replace the Sites authentication boundary and Worker adapter deliberately. Do not enable trusted header identity on a public Next.js server. Account and administrator functionality must remain disabled until a secure established provider/session validator replaces that boundary. The HTTP database and business modules are portable, but hosting-specific auth, sign-in paths and runtime environment access require validation.

## Launch checklist

- Obtain an approved product data source; validate normalized offers and provenance against the actual feed.
- Obtain affiliate approval and configure only the tracking identifiers issued to the publisher.
- Apply the database migration, validate RLS and user isolation, and verify account deletion against a test account.
- Configure trusted hosted identity, administrator membership, database backups and production secrets.
- Run type checks, essential tests, the production build, and mobile/desktop browser journeys.
- Exercise retailer/AI outages, empty results, unsupported currency, consent denial, and disabled integrations.
- Provide business contact and a deployment-specific privacy policy covering the actual configured processors and retention.
- Implement a scheduled price collector and a verified notification channel before enabling price-drop alerts. An alert UI alone is not monitoring.
- Implement authenticated affiliate-network webhooks, idempotency and event validation before displaying confirmed conversions or commission revenue.

Core shopping stays free. Potential later additions include explicitly labeled sponsorships, premium research reports and advanced tracking, after useful recommendations and trustworthy data are established. None of those revenue features is silently enabled in this release.

### Native Next.js development

`npm run dev:next` runs the same App Router source on port 3000 without the local Cloudflare runtime. This is useful on Linux kernels whose ARM virtual address layout cannot launch Workerd. `npm run build:next` is a separate Next.js build; the Sites publication artifact still uses `npm run build`. Browser tests start the native Next.js development server automatically when needed.
