# Security and privacy

## Threat model

Primary risks are cross-tenant reads, role escalation, forged financial mutations, malicious uploads, webhook replay, prompt injection, secret leakage and inappropriate employee accusations.

## Controls

Every tenant record carries `organisation_id`; venue records also carry `venue_id`. Composite foreign keys prevent cross-tenant parent references. Server authorization resolves membership, explicit capability and venue assignment for every request. RLS and protected database functions enforce the same boundary. Viewer writes and manager billing access are denied. Immutable close snapshots and append-only audit events protect history. Files are stored in private Supabase Storage buckets with organisation-scoped policies; upload services must also enforce MIME, size, hashing and filename sanitisation before their workflows are considered complete.

Secrets remain server-only and are validated at startup. Webhooks require signatures and unique event IDs. Scheduled jobs require `CRON_SECRET`, bounded retries and idempotency. Errors return correlation IDs rather than stacks. Logs redact document bodies, tokens and personal data.

Invoice text is untrusted content. Extraction prompts explicitly prohibit following document instructions; strict schemas, deterministic total checks and human confirmation precede product cost changes. AI can be disabled. Only verified snapshot values enter a briefing, and generated values absent from the snapshot are rejected.

GDPR controls include export/deletion requests, retention configuration, no optional analytics before consent, and service inventory. OpenAI receives invoice content only when the organisation enables extraction. Production must configure the legal company, privacy and support fields.

## Verification

Review queries for organisation predicates, capability checks, private object paths, snapshot immutability, audit write-only access, webhook replay handling, upload bounds and log redaction. Run dependency audit and `npm run verify` for every release. Local build verification is not a substitute for the remote multi-identity RLS and Storage suite.
