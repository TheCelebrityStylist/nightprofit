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
| Nightly close persistence and snapshots | Prototype UI only | Partial: create, exact lines, transitions, successor reopen and approval snapshot | Local calculation/build tests; authenticated browser flow pending | `/api/closes*`, protected `transition_close` | Seeded test users |
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
| Real authenticated shell | Synthetic app data | Implemented for `/app`; `/demo` remains synthetic | Build verified; deployed auth acceptance pending | `app/authenticated-app.tsx` | Seeded test user |
| Authenticated Dutch/English parity | Dutch-only authenticated screens | Typed `lib/i18n` dictionary, cookie-persisted locale, `<html lang>` follows locale, switcher in `/app`, login/signup/reset/onboarding/close translated, close API returns stable error codes | Yes — key-parity + rendered NL/EN tests | `lib/i18n/*`, `app/locale-switcher.tsx`, `tests/i18n-parity.test.ts`, `tests/rendered-html.test.mjs` | None |
| Deployed browser acceptance matrix | Incomplete | No | Pending deploy and test identities | This matrix | Seeded test users |

## Current verification

- `npm ci`: passed (local Node 22.12 emits an engine warning; project requires 22.13+).
- `npm run verify`: passed: lint, typecheck, 29 tests (6 credential-dependent skipped) and production build.
- `npm run test:e2e`: 4 rendered-route tests passed (public, demo, and NL/EN sign-in).
- `npm audit --omit=dev`: 0 production vulnerabilities.
- Remote RLS: 6 cases skipped, therefore not counted as passed.

## Acceptance gate

NightProfit must not be called production-ready until every code-controlled row is complete and every credential-dependent row has remote evidence. Missing legal company, address, privacy contact and support ownership remain owner launch decisions.
