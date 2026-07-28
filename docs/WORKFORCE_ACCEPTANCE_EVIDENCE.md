# Workforce acceptance evidence

## 28 July 2026 — availability request journey

- Environment: production Sites application and production Supabase.
- Controlled actors: owner, venue manager, scheduler, two same-venue employees, one other-venue employee and a read-only member.
- Controlled scope: one temporary organisation, two venues, one department, one role, qualifications, one demand interval and one published shift.
- Manager authentication: passed.
- Employee authentication and self-service workspace: passed.
- Manager created one request for two same-venue employees: passed.
- Individual 256-bit response links and manual-copy fallback: passed.
- Employee mobile review and submission: passed.
- Manager completion view: `2/2 ingediend`.
- Persisted outcome before cleanup: 14 availability ranges, five material operational events and two copyable-message outbox records.
- Invalid token response: returned `invalid` without tenant or employee data.
- Runtime defect found during acceptance: offset timestamps and API-to-database field mapping; both corrected and redeployed before the passing run.
- Cleanup: controlled organisation, tenant data, tokens and all controlled authentication identities removed after verification.

No passwords, response tokens, personal contact information or tenant identifiers are retained in this evidence.
