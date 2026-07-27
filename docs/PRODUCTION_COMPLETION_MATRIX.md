# Production completion matrix

Status is evidence-based. “Implemented” never means credential-tested.

| Requirement | Status before pass | Implemented in this pass | Tested | Evidence | External configuration |
|---|---|---:|---:|---|---|
| Public product site and synthetic demo | Complete | Preserved | Yes | Rendered-route tests | None |
| Exact-money calculation contract | Complete | Expanded | Yes | Vitest financial suite | None |
| Supabase PostgreSQL schema | Incomplete | Yes | Pending remote application | `supabase/migrations/20260727000100_initial_production.sql` | Supabase project selection |
| PostgreSQL RLS and tenant isolation | Incomplete | Yes | Pending two-user remote tests | Migration policies and RLS tests | Supabase project |
| Supabase private Storage | Incomplete | Yes | Pending remote test | `invoices`/`imports` bucket policies | Supabase project |
| Email/password auth and SSR sessions | Incomplete | Yes | Pending deployed browser test | `lib/supabase/*`, auth routes | Supabase URL/keys, redirect URLs |
| Organisation, venue and invitation persistence | Incomplete | Yes | Pending deployed browser test | Server actions and schema | Email delivery optional |
| Nightly close persistence and snapshots | Prototype UI only | Partial | Unit-tested calculations; remote pending | Schema, close service | Supabase project |
| Events and organiser payouts | Prototype UI only | Partial | Unit tested | Schema and calculation library | None |
| Products, recipes and margin history | Prototype UI only | Partial | Unit tested | Schema and calculation library | None |
| Invoice private upload/manual review | Prototype UI only | Partial | Remote pending | Storage/schema boundary | Supabase project |
| OpenAI invoice extraction | Incomplete | No | No | Adapter boundary only | OpenAI key |
| CSV transactional imports | Prototype UI only | Partial | Unit tests pending expansion | Schema/import module | Supabase project |
| Deterministic alerts and briefing | UI fixture only | Partial | Unit tests | Rules module | None |
| Reports/CSV/print | Prototype UI only | Partial | Render test | UI/report boundaries | None |
| Stripe products and prices | Incomplete | Code-ready | Pending account inspection | Billing adapter | Stripe sign-in |
| Stripe checkout/webhooks/portal | Incomplete | Yes | Pending test-mode E2E | API routes + event table | Stripe keys/webhook |
| Security headers and safe errors | Partial | Yes | Build/header tests | `next.config.ts`, server helpers | None |
| Data export/deletion/retention/AI control | Partial | Schema complete | Remote pending | Migration and settings | Legal owner decisions |
| Scheduled briefing/email | Incomplete | Boundary only | No | Job tables | Resend/OpenAI/Cron |
| Deployed browser acceptance matrix | Incomplete | No | Pending credentials/deploy | This matrix | Supabase and Stripe sessions |

## Acceptance gate

NightProfit must not be called production-ready until every code-controlled row is complete and every credential-dependent row has remote evidence. Missing legal company, address, privacy contact and support ownership remain owner launch decisions.
