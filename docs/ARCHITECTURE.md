# Architecture

NightProfit is a Vinext/React application deployed as a Cloudflare Worker through Sites. Server-rendered routes own identity, authorization and persistence; client components own navigation and form interactivity only. D1 stores structured tenant records and R2 stores private uploads under organisation-scoped keys.

## Boundaries

The calculation module accepts and returns integer minor units or basis points. Database records store inputs, outputs and immutable close snapshots. Integration adapters translate external data into validated internal commands; they never write arbitrary fields. Invoice extraction and narrative briefings are optional adapters whose structured output is validated before use.

Authentication for the deployed private product uses the hosting platform's authenticated identity. A production multi-customer launch requires an explicit public identity decision rather than a fabricated local auth stack. Each server operation resolves the actor, membership, role and venue scope before querying.

Jobs use unique idempotency keys per venue, trading date and task. Audit records are append-only application events. Future modules register navigation, entitlements, permissions and event hooks without coupling to core calculations.
