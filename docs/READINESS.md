# Velora readiness

This document distinguishes implemented development capabilities from external activation and verification. A passing test with synthetic data is not evidence that live prices, emails, affiliate revenue or Apple notarization work.

| Capability | Implemented in 0.2 | Required before claiming production operation |
| --- | --- | --- |
| Shopping UI | Responsive search, filtering, comparisons, persisted shortlist, dark mode, product sources | Test representative live catalog/marketplace data and accessibility on target devices |
| AI | OpenAI Responses structured shopping tool, validated arguments, factual retrieval boundary | API credentials/model, quota, live staging request and quality evaluation |
| Retailer data | eBay OAuth/Browse adapter and approved normalized feed adapter | Credentials/API approval or approved feed, correct market, live price/stock verification |
| Accounts | Supabase Auth, private cookies, verification/recovery, sync and deletion | Supabase project/migrations, redirect configuration, SMTP, abuse controls, staging account tests |
| Database | Versioned PostgreSQL migrations, RLS/grants, tested monitoring transactions | Apply migrations and verify backups/restore/retention with actual Supabase |
| Price monitoring | Authenticated job, leases, observations, account alerts and history | Configure scheduler and secret, observe successful real runs, scale beyond 20 alerts/run |
| Notifications | Durable in-app price notifications and read state | Real threshold-crossing smoke test; email/push delivery is not part of this release |
| Affiliate links | Approved URL mapping, eBay EPN campaign support, consented clicks | Affiliate program approval and end-to-end attribution verification |
| Conversions/revenue | Schema and honest disconnected dashboard state | Network-specific verified ingestion still needs implementation |
| Mac app | Apple Silicon DMG, hosted/local development modes, navigation isolation | Developer ID credentials/notarization and physical-device launch/sign-in test |
| Deployment | Native Next and Sites Worker builds, CI and tagged releases | Production secrets, distributed edge limits, monitoring and operational ownership |

The hosted Site retains owner-only access and defaults to `PRODUCT_PROVIDER=demo` and `AI_PROVIDER=local`. Publishing code does not provision external services, approve affiliate programs or activate a scheduler. The desktop app opens that hosted service; it is not an offline catalog or an independently hosted backend.

The GitHub Actions logs and release assets are the source of truth for checks run on a particular commit. Local Docker-based Supabase must be exercised on a machine with Docker; protocol fixtures and PGlite are available without Docker.
