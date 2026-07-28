# Production completion matrix

Status is evidence-based. “Implemented” never means credential-tested.

| Requirement | Status before pass | Implemented in this pass | Tested | Evidence | External configuration |
|---|---|---:|---:|---|---|
| Public product site and synthetic demo | Complete | Preserved | Yes | Rendered-route tests | None |
| Exact-money calculation contract | Complete | Expanded | Yes | Vitest financial suite | None |
| Supabase PostgreSQL schema | Incomplete | Expanded and applied | SQL editor execution succeeded | Migrations through `20260728000100` | None |
| PostgreSQL RLS and tenant isolation | Incomplete | Capability/RLS and composite FKs applied | Remote identity suite still skipped | `has_capability`, composite tenant FKs | Test identities |
| Supabase private Storage | Incomplete | Six private buckets/policies applied | Remote upload/download suite pending | Storage policies in migrations | Test identities |
| Email/password auth and SSR sessions | Incomplete | Yes | Pending deployed browser test | `lib/supabase/*`, auth routes | Supabase URL/keys, redirect URLs |
| Organisation, venue and invitation persistence | Incomplete | Yes | Pending deployed browser test | Server actions and schema | Email delivery optional |
| Nightly close persistence and snapshots | Prototype UI only | Usable authenticated list, detail, exact line entry, server transitions, successor reopen, audit line and approval snapshot | Local calculation/build tests; authenticated browser flow pending | `/app/close*`, `/api/closes*`, protected `transition_close` | Sites allowlist and seeded test users |
| Events and organiser payouts | Prototype UI only | Partial | Unit tested | Schema and calculation library | None |
| Products, recipes and margin history | Prototype UI only | Partial | Unit tested | Schema and calculation library | None |
| Invoice private upload/manual review | Prototype UI only | Partial | Remote pending | Storage/schema boundary | Supabase project |
| OpenAI invoice extraction | Incomplete | No | No | Adapter boundary only | OpenAI key |
| CSV transactional imports | Prototype UI only | Partial | Unit tests pending expansion | Schema/import module | Supabase project |
| Deterministic alerts and briefing | UI fixture only | Partial | Unit tests | Rules module | None |
| Reports/CSV/print | Prototype UI only | Partial | Render test | UI/report boundaries | None |
| Stripe products and prices | Incomplete | Test catalogue configured | Account inspected in test mode previously | Billing adapter and configured Sites environment | None |
| Stripe checkout/webhooks/portal | Incomplete | Yes | Pending test-mode E2E | API routes + event table | Stripe keys/webhook |
| Security headers and safe errors | Partial | Yes | Build/header tests | `next.config.ts`, server helpers | None |
| Data export/deletion/retention/AI control | Partial | Schema complete | Remote pending | Migration and settings | Legal owner decisions |
| Scheduled briefing/email | Incomplete | Boundary only | No | Job tables | Resend/OpenAI/Cron |
| Group booking authenticated workflow | Schema only | Inquiry capture and live pipeline implemented; quote builder, public acceptance, deposits, upsells and guest lists remain incomplete | Typecheck/build passed; remote acceptance pending | `/app/bookings`, `/api/workflows` | Sites allowlist and seeded test users |
| Supplier guard authenticated workflow | Schema only | Supplier creation, live directory, contract/discrepancy views implemented; document upload and invoice comparison remain incomplete | Typecheck/build passed; remote acceptance pending | `/app/suppliers`, `/api/workflows` | Sites allowlist and seeded test users |
| Event yield authenticated workflow | Schema only | Deterministic event/base-scenario creation with server money, contribution and break-even calculations; approval/actual/backtesting remain incomplete | Typecheck/build and financial tests passed | `/app/yield`, `/api/workflows` | Sites allowlist and seeded test users |
| Staff compliance authenticated workflow | Schema only | Restricted profile and factual draft-incident creation plus live lists; policies, acknowledgements and certificate workflows remain incomplete | Typecheck/build passed; remote acceptance pending | `/app/compliance`, `/api/workflows` | Sites allowlist and seeded test users |
| Real authenticated shell | Synthetic app data | Implemented tenant-scoped command center and five operational module surfaces; `/demo` remains synthetic | Build verified; deployed auth acceptance pending | `app/authenticated-app.tsx` | Sites allowlist and seeded test user |
| Deployed browser acceptance matrix | Incomplete | No | Sites authentication reached but signed-in account is not on the custom allowlist | This matrix | Add `elkejaspers.eac@gmail.com` or sign in as `porttripapp@gmail.com` |

## Current verification

- `npm ci`: passed (local Node 22.12 emits an engine warning; project requires 22.13+).
- `npm run verify`: passed: lint, typecheck, 23 tests and production build.
- `npm run test:e2e`: 2 rendered-route tests passed.
- `npm audit --omit=dev`: 0 production vulnerabilities.
- Remote RLS: 6 cases skipped, therefore not counted as passed.
- `20260728000200_production_workflows`: applied through the authenticated Supabase SQL editor and recorded in migration history.
- `20260728000300_workflow_write_policies`: applied through the authenticated Supabase SQL editor and recorded in migration history.
- Sites access acceptance: blocked by the current custom allowlist, which contains only `porttripapp@gmail.com`.

## Acceptance gate

NightProfit must not be called production-ready until every code-controlled row is complete and every credential-dependent row has remote evidence. Missing legal company, address, privacy contact and support ownership remain owner launch decisions.
