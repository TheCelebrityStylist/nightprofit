# Architecture

NightProfit is a Vinext/React application deployed as a Cloudflare Worker through Sites. Server-rendered routes own identity, authorization and persistence; client components own navigation and form interactivity only. Supabase PostgreSQL stores tenant records, Supabase Auth owns identity, and private Supabase Storage buckets store uploads under organisation-scoped paths.

## Boundaries

The calculation module accepts and returns integer minor units or basis points. Database records store inputs, outputs and immutable close snapshots. Integration adapters translate external data into validated internal commands; they never write arbitrary fields. Invoice extraction and narrative briefings are optional adapters whose structured output is validated before use.

Application authentication uses Supabase SSR sessions. Sites access control remains an additional private deployment boundary, not the application authorization layer. Each server operation resolves the actor, membership, capability and venue scope before querying. PostgreSQL RLS and protected functions repeat that boundary.

Jobs use unique idempotency keys per venue, trading date and task. Audit records are append-only application events. Future modules register navigation, entitlements, permissions and event hooks without coupling to core calculations.
