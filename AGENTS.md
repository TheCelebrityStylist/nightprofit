# NightProfit engineering contract

## Repository map

- `app/`: public site, synthetic demo and product workflows.
- `lib/calculations.ts`: pure financial truth; integer minor units only.
- `db/schema.ts`: tenant-owned D1 persistence model.
- `drizzle/`: generated, reviewed migrations.
- `docs/`: product, architecture, calculation and security decisions.
- `tests/`: deterministic calculation and rendered-route checks.

## Commands

`npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run verify`, `npm run db:generate`.

## Non-negotiable constraints

Financial amounts are integer minor units and percentages are basis points. Never use floating point for authoritative calculations. Historical reports read immutable snapshots. Every tenant-owned record contains `organisation_id`; venue-scoped records also contain `venue_id`. Authorization is enforced server-side at every mutation and database query. AI may extract or explain schema-validated, server-produced values but is never the source of financial truth. Do not add placeholders, dead controls, fake integrations, accusations, fabricated proof, or unverified production claims. Run `npm run verify` before handoff.
