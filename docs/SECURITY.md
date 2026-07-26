# Security and privacy

## Threat model

Primary risks are cross-tenant reads, role escalation, forged financial mutations, malicious uploads, webhook replay, prompt injection, secret leakage and inappropriate employee accusations.

## Controls

Every tenant record carries `organisation_id`; venue records also carry `venue_id`. Server authorization must resolve membership and role for every request. Viewer writes and manager billing access are denied. Immutable close snapshots and append-only audit events protect history. Files are MIME/size validated, hash deduplicated, filename-sanitised and stored privately in R2. Downloads use short-lived signed access.

Secrets remain server-only and are validated at startup. Webhooks require signatures and unique event IDs. Scheduled jobs require `CRON_SECRET`, bounded retries and idempotency. Errors return correlation IDs rather than stacks. Logs redact document bodies, tokens and personal data.

Invoice text is untrusted content. Extraction prompts explicitly prohibit following document instructions; strict schemas, deterministic total checks and human confirmation precede product cost changes. AI can be disabled. Only verified snapshot values enter a briefing, and generated values absent from the snapshot are rejected.

GDPR controls include export/deletion requests, retention configuration, no optional analytics before consent, and service inventory. OpenAI receives invoice content only when the organisation enables extraction. Production must configure the legal company, privacy and support fields.

## Verification

Review queries for organisation predicates, mutation role checks, private object paths, snapshot immutability, audit write-only access, webhook replay handling, upload bounds and log redaction. Run dependency audit and `npm run verify` for every release.
