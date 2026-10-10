# Developing Velora 0.2.0

The guest shopping experience needs Node.js and the checked-in catalog. Local accounts use Supabase's Docker stack; live retailer access requires credentials and approval from the selected provider. Synthetic protocol tests and real PostgreSQL migration tests run without paid services.

## Start the application

Use Node.js 24 LTS (minimum 22.13), npm, and macOS/Linux or a Linux development environment:

```sh
cd web
npm ci
npm run doctor
npm run dev:local
```

Open `http://127.0.0.1:3000`. `dev:local` binds to loopback. `dev:next` retains the preview's all-interface binding; use it deliberately when another device needs access. The default demo adapter labels sample prices and unverified facts. Guest saves and preferences remain in this browser.

Native Next.js production commands are separate from the Cloudflare/Sites adapter:

```sh
npm run build:next
npm run start:next
```

`npm run build` builds the configured Sites/Vinext target. A native Next build does not deploy either target. See [Next CLI documentation](https://nextjs.org/docs/app/api-reference/cli/next) for supported flags.

## Local accounts and PostgreSQL

Install and start Docker Desktop or another compatible local Docker daemon. The scripts use the pinned Supabase CLI 2.120.0 through `npx`; its first use downloads the CLI and container images. No hosted Supabase account, project link, or paid credentials are needed.

```sh
cd web
npm run local:start
npm run local:env
npm run doctor -- --full
npm run dev:local
```

`local:start` applies `supabase/migrations` to the local database. `local:env` reads local status through a captured pipe and creates an ignored, mode 0600 `.env.local`; it never prints keys or overwrites an existing file. Keep an existing environment file or move it aside before generating another. Server-only keys must never use a `NEXT_PUBLIC_` prefix.

| Service | Local address |
| --- | --- |
| Velora | `http://127.0.0.1:3000` |
| Supabase API | `http://127.0.0.1:54321` |
| PostgreSQL | `127.0.0.1:54322` |
| Supabase Studio | `http://127.0.0.1:54323` |
| Captured development email | `http://127.0.0.1:54324` |

Create an account in Velora, open its confirmation message in the captured local inbox, and follow the confirmation link. Recovery messages are captured there too; the local stack does not deliver them to an external mailbox. The committed templates use token hashes and `/auth/confirm`. `APP_URL` and the browser hostname must remain consistent for same-origin requests and cookies. The generated environment selects local Supabase, the demo catalog, and local intent parsing. It does not enable live shopping or email price alerts.

To rebuild this local project's database from migrations, keep the local stack running. This removes its existing local data:

```sh
npm run local:reset
```

When you finish using the local stack, stop it separately:

```sh
npm run local:stop
```

Never append `--linked` or a hosted database URL to local reset commands. `supabase/config.toml` has no hosted project linkage. See [Supabase local workflow](https://supabase.com/docs/guides/local-development/cli-workflows) and [configuration reference](https://supabase.com/docs/guides/local-development/cli/config).

## Hosted Supabase configuration

For a real Supabase project, apply the two versioned migrations, configure server-only URL/keys, and set the Auth Site URL to the same HTTPS origin as `APP_URL`. Add that origin’s `/auth/confirm` to allowed redirects. In the Auth email template editor, use these links for confirmation and recovery respectively:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=signup">Confirm email address</a>
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery">Reset password</a>
```

Use production subjects/content rather than the local templates’ development-inbox wording. Configure your SMTP sender and Supabase rate limits before public signups. Test email delivery, confirmation, sign-in, recovery and deletion against that project; local protocol fixtures do not prove real email delivery.

## Verification without external services

Before the browser checks, stop any existing native Next development server so the guest suite starts with the explicit demo configuration below. Clear `PLAYWRIGHT_BASE_URL` so it cannot redirect the checks to another running deployment. If the local Supabase stack is running, stop it before `test:integration`: the synthetic protocol server reserves port 54321 and refuses to reuse an existing service.

```sh
npm run typecheck
npm test
npm run test:db
npx playwright install chromium
unset PLAYWRIGHT_BASE_URL
PRODUCT_PROVIDER=demo AI_PROVIDER=local npm run test:e2e
npm run test:integration
```

Run the browser suites sequentially. Each suite starts and stops its own Next development server; running them together conflicts with Next's development build lock. Setting provider variables cannot change the configuration of a server that is already running.

- `test:e2e` exercises guest discovery, budget filtering, saved products, comparison, retailer redirects, local price targets, responsive layout, and preferences against the demo adapter.
- `test:integration` starts an isolated Next server on port 3100 and an explicitly synthetic protocol server on port 54321. It exercises real application route validation, feed parsing, affiliate redirect configuration, Supabase-style confirmation/session cookies, storage ownership, and rejection paths. The fixture's invented products, users, keys, and URLs are test data. It does not verify a real retailer, GoTrue deployment, notification delivery, or an affiliate partnership.
- `test:db` executes the checked-in migrations in [PGlite](https://pglite.dev/docs/), real PostgreSQL compiled to WebAssembly. It checks SQL permissions/RLS, lease state transitions, target crossings, invalid observations, account cascades, and history ownership. PGlite uses one serialized connection, so this is not a multi-process concurrency/load test.

The browser screenshots and traces are written under ignored `web/outputs/`. On ARM machines with an existing supported Chromium installation, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point to its executable. Keep this override local; CI installs Playwright's matching browser.

## Desktop development

Start the web server first, then:

```sh
cd desktop
npm ci
npm test
VELORA_DESKTOP_ALLOW_LOCALHOST=true VELORA_DESKTOP_DEV_URL=http://127.0.0.1:3000 npm start
```

Only unpackaged Electron builds accept the explicitly selected loopback origin. Local development has a separate persistent session; packaged builds keep the public HTTPS allowlist. Confirmation links opened in another browser confirm the account there; sign in inside Velora afterward. See [desktop setup and release requirements](../desktop/README.md).

## Monitoring job and CI

The verification workflow checks TypeScript, unit tests, PostgreSQL migrations, both build targets, guest browser journeys, synthetic protocol integration, and desktop navigation security.

The `Check configured price alerts` workflow supports manual invocation and a nightly 03:17 UTC schedule. It skips until an operator sets repository variable `VELORA_ALERT_JOB_URL` to the exact public HTTPS `/api/cron/price-alerts` endpoint and secret `VELORA_CRON_SECRET` to the server's `CRON_SECRET`. It sends a bearer-authenticated POST and logs aggregate counts only. An active live provider, persistent database, migrated SQL, and enabled user alerts must also exist. No credentials or confirmed notifications are supplied by the repository. This change does not dispatch the workflow.

An ordinarily reachable Next deployment needs only the job secret. An owner-private hosted Site also requires repository secret `VELORA_SITES_SERVICE_TOKEN` for its separate hosting access gate; the runner sends it in `OAI-Sites-Authorization`. This does not make the Site public. The runner refuses redirects and never logs either credential, so tokens cannot be forwarded to a redirected origin.

Desktop release tags must match `desktop/package.json` (current milestone `v0.2.0`). The release workflow builds and verifies an Apple Silicon DMG on macOS. A local Linux test run does not prove macOS launch, signing, notarization, or identity-provider acceptance; those require the configured release pipeline and a real Mac.

## Verification limits in this workspace

Docker and Podman are unavailable in the development container used to prepare this milestone. Supabase CLI configuration parsing can be checked here, but starting GoTrue/PostgREST/PostgreSQL containers and testing captured email require a Docker-capable machine. Protocol fixtures and PGlite cover their documented boundaries; they do not stand in for a completed Docker smoke test.
