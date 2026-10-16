# NightProfit engineering contract

## Repository map

- `app/`: public site, synthetic demo and product workflows.
- `lib/calculations.ts`: pure financial truth; integer minor units only.
- `supabase/migrations/`: reviewed PostgreSQL, RLS and Storage migrations.
- `lib/supabase/`: authenticated PostgreSQL and Storage access boundaries.
- `docs/`: product, architecture, calculation and security decisions.
- `tests/`: deterministic calculation and rendered-route checks.

## Commands

`npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`, `npm run verify`, `npm run db:types`, `npm run db:push`.

## Base44 sandbox setup

- The app runs via `docker-compose.base44.yml` (node:22, source bind-mounted, `npm ci` then `npx vinext dev -H 0.0.0.0 --port 3000`). The dev server must bind 0.0.0.0 to be reachable through the preview proxy.
- `vite.config.ts` adds `server.allowedHosts: [".${BASE44_SANDBOX_HOST_DOMAIN}"]` only when `BASE44_PREVIEW_MODE === "1"`; the platform also sets `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`. The proxy forwards `Host: <port>-<sandboxid>.e2b.app`, not the public `base44-preview.app` URL.
- No secrets are required to boot: the public site (`/`) and synthetic demo (`/demo`) render with no credentials. Authenticated routes (`/app/*`) call Supabase and fail closed (HTTP 500, "Configuration required") until `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are supplied — this is intended, do not fake it.

## Non-negotiable constraints

Financial amounts are integer minor units and percentages are basis points. Never use floating point for authoritative calculations. Historical reports read immutable snapshots. Every tenant-owned record contains `organisation_id`; venue-scoped records also contain `venue_id`. Authorization is enforced server-side at every mutation and database query. AI may extract or explain schema-validated, server-produced values but is never the source of financial truth. Do not add placeholders, dead controls, fake integrations, accusations, fabricated proof, or unverified production claims. Run `npm run verify` before handoff.
