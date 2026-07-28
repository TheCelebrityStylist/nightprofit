# Production completion matrix

Status is evidence-based. “Implemented” never means credential-tested.

| Requirement | Status before pass | Implemented in this pass | Tested | Evidence | External configuration |
|---|---|---:|---:|---|---|
| Public product site and synthetic demo | Complete | Preserved | Yes | Rendered-route tests | None |
| Exact-money calculation contract | Complete | Expanded | Yes | Vitest financial suite | None |
| Supabase PostgreSQL schema | Incomplete | Expanded and applied | SQL editor execution succeeded | Migrations through `20260728000100` | None |
| PostgreSQL RLS and tenant isolation | Incomplete | Capability/RLS, composite FKs, employee self-service and manager publication boundaries applied | 9 remote identity/planning cases passed | `has_capability`, remote Vitest suite | None |
| Supabase private Storage | Incomplete | Six private buckets/policies applied | Remote upload/download suite pending | Storage policies in migrations | Test identities |
| Email/password auth and SSR sessions | Incomplete | Yes | Pending deployed browser test | `lib/supabase/*`, auth routes | Supabase URL/keys, redirect URLs |
| Organisation, venue and invitation persistence | Incomplete | Yes | Pending deployed browser test | Server actions and schema | Email delivery optional |
| Nightly close persistence and snapshots | Prototype UI only | Usable authenticated list, detail, exact line entry, server transitions, successor reopen, audit line and approval snapshot | Local calculation/build tests; authenticated browser flow pending | `/app/close*`, `/api/closes*`, protected `transition_close` | Seeded test users |
| Events and organiser payouts | Prototype UI only | Partial | Unit tested | Schema and calculation library | None |
| Products, recipes and margin history | Prototype UI only | Product + effective cost and first-component recipe + immutable price/margin snapshot are usable and atomic; multi-component editing, nested recipes and price simulation remain | Financial tests and production build passed; authenticated browser acceptance pending | `/app/products`, protected PostgreSQL functions, operational events | Controlled test identity |
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
| Group booking authenticated workflow | Schema only | Inquiry capture and live pipeline implemented; quote builder, public acceptance, deposits, upsells and guest lists remain incomplete | Typecheck/build passed; remote acceptance pending | `/app/bookings`, `/api/workflows` | Seeded test users |
| Supplier guard authenticated workflow | Schema only | Supplier creation, live directory, contract/discrepancy views implemented; document upload and invoice comparison remain incomplete | Typecheck/build passed; remote acceptance pending | `/app/suppliers`, `/api/workflows` | Seeded test users |
| Event yield authenticated workflow | Schema only | Deterministic event/base-scenario creation with server money, contribution and break-even calculations; approval/actual/backtesting remain incomplete | Typecheck/build and financial tests passed | `/app/yield`, `/api/workflows` | Seeded test users |
| Staff compliance authenticated workflow | Schema only | Restricted profile and factual draft-incident creation plus live lists; policies, acknowledgements and certificate workflows remain incomplete | Typecheck/build passed; remote acceptance pending | `/app/compliance`, `/api/workflows` | Seeded test users |
| Today operating brief | Generic dashboard | Live same-day demand, guests, revenue, scheduled labor, labor percentage, close/deposit/discrepancy risk and evidence-linked actions | Calculation/type/build tests; deployed authenticated acceptance pending | `/app/dashboard`, control-loop schema | Seeded test user |
| Forecast-to-roster control loop | Missing | Interval demand planning, required staffing, departments, roles, named/open draft shifts, overlap rejection, deterministic governed proposal and atomic manager publication | 4 calculation cases and 3 remote manager/employee cases passed | `/app/planning`, `/api/planning`, protected PostgreSQL functions | Deployed authenticated acceptance pending |
| Governed AI proposals | Missing | Strict persisted proposal envelope and deterministic schedule fallback with rationale, input snapshot, missing data, confidence basis, approval/execution states | Local calculation and remote RLS boundaries passed | `ai_proposals`, `/api/planning` | OpenAI credential adapter not implemented |
| Real authenticated shell | Synthetic app data | Implemented tenant-scoped Today and five operational module surfaces; `/demo` remains synthetic | Build verified; deployed auth acceptance pending | `app/authenticated-app.tsx` | Seeded test user |
| Deployed browser acceptance matrix | Incomplete | Hosting access is public; product access remains protected by Supabase authentication | Pending authenticated customer-flow acceptance | This matrix | Seeded test users |

## Current verification

- `npm ci`: passed (local Node 22.12 emits an engine warning; project requires 22.13+).
- `npm run verify`: passed: lint, typecheck, 27 local tests and production build.
- `npm run test:e2e`: 2 rendered-route tests passed.
- `npm audit --omit=dev`: 0 production vulnerabilities.
- Remote RLS: 9 cases passed against the production Supabase project; controlled identities were removed after the run.
- `20260728000200_production_workflows`: applied through the authenticated Supabase SQL editor and recorded in migration history.
- `20260728000300_workflow_write_policies`: applied through the authenticated Supabase SQL editor and recorded in migration history.
- `20260728000400_operations_control_loop`: reviewed, applied and production-verified (10 tables, 20 initial policies, 2 protected functions).
- `20260728000500_employee_planning_boundary`: applied; employee self-service and manager-only roster publication verified remotely.
- `20260728000600_service_role_default_grants`: applied after remote tests exposed missing grants on post-foundation tables.
- `20260728000900_product_recipe_workflow`: applied and registered; atomic product/cost and menu-item/component/margin commands are available.
- Sites hosting access is public. Product data remains protected by Supabase authentication, membership checks and RLS.

## Acceptance gate

NightProfit must not be called production-ready until every code-controlled row is complete and every credential-dependent row has remote evidence. Missing legal company, address, privacy contact and support ownership remain owner launch decisions.
