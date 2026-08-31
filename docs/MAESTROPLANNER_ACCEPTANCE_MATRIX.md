# Maestroplanner acceptance matrix

This matrix tracks the current source on `codex/nightprofit-os-production` and is updated as code-controlled gaps close. “Implemented” means an actual persisted operation exists; it does not imply remote acceptance.

| Workflow | Classification | Evidence and remaining gate |
| --- | --- | --- |
| Week planner, departments, sticky axes, demand/cost context | Fully implemented and tested | `app/roster-board.tsx`, `app/real-app.css`, rendered-route tests. |
| Day and month planner views | Implemented; authenticated acceptance pending | Service timeline and concise month grid in `app/roster-board.tsx`. |
| Create, drag, reassign, resize, duplicate, lock, copy week, autosave | Fully implemented and tested | `/api/planning`; `shifts` revisions and idempotent `job_runs`. |
| Multi-select, bulk edit, delete, undo and redo | Implemented; remote migration and authenticated acceptance pending | `20260729001600_visual_planner_history.sql`; atomic revision-guarded RPCs. |
| Templates and recurring shifts | Implemented; remote migration and authenticated acceptance pending | Relative-time patterns, idempotent application and bounded weekly recurrence in `20260729001700_roster_templates.sql`. |
| Draft-versus-published comparison | Partially implemented | Immutable snapshot exists; comparison UI is absent. |
| WhatsApp-first employee invite | Implemented; remote migration and authenticated acceptance pending | Atomic staff/team/role creation, 256-bit expiring invitation, employee-only activation, manual WhatsApp/copy state and bilingual messages in `20260729001800_employee_onboarding.sql`. Provider delivery remains honestly unavailable. |
| Progressive employee record | Partially implemented | Core profile/contract/cost/qualification fields persist; editing multiple roles, supplements and certifications is incomplete. |
| CSV import | Implemented; authenticated acceptance pending | Preview, validation, partial import, duplicate behavior and idempotent receipt exist. |
| Availability request management | Partially implemented | Period, deadline, recipients, preview/manual share, reminders, extension and cancellation exist; provider send and richer recipient UI remain. |
| Employee availability response | Partially implemented | Secure scoped token, multiple windows, partial/final save, deadline and revocation exist; recurring/copy interactions remain. |
| Staffing requirements | Partially implemented | Persisted interval demand and evidence-backed deterministic minimums exist; role requirements and all evidence sources are not normalized into one version. |
| Three roster alternatives | Partially implemented | Three deterministic proposals persist and apply to drafts; explanation/diff/cost-target completeness remains. |
| What-if | Partially implemented | Persisted non-authoritative demand scenario exists; other scenario types and apply flow remain. |
| Immutable publication | Partially implemented | Idempotent, concurrent, immutable successor snapshots and server hard constraints exist; stale evidence, full preview and communication queue remain. |
| Leave and sickness replacement | Partially implemented | Persistent requests/decisions and ranked replacements exist; split replacement/open-offer/successor communication loop remains. |
| Open shifts | Implemented; remote migration and authenticated concurrency acceptance pending | Manager offer, employee-scoped eligibility, expiry, locked/idempotent claim, hard-rule revalidation and immutable successor publication in `20260729002000_governed_open_shifts.sql`. |
| Controlled swaps | Implemented; remote migration and authenticated acceptance pending | Employee proposal, scoped candidate list/consent, manager decision, hard-rule revalidation, cost comparison and immutable successor publication in `20260729001900_controlled_shift_swaps.sql`. |
| Append-only attendance and corrections | Implemented; remote migration and authenticated acceptance pending | Immutable/idempotent clock ledger, guarded transitions, explicit manager-authored missed events and reasoned correction decisions in `20260729002100_append_only_timekeeping.sql`. |
| Labour-to-close propagation | Implemented; remote migration and authenticated acceptance pending | `20260729002200_authoritative_labour_propagation.sql` makes manager approval the calculation boundary, expands paid minutes in venue time, applies dated supplements and recorded/planned breaks, creates immutable hashed results, and propagates only that evidence into Live Profit Pulse, learning and the mutable close draft. |
| Workforce exception inbox and learning | Partially implemented; planner binding and authenticated acceptance pending | `20260729002400_workforce_exception_learning.sql` provides the capability-gated ranked queue and immutable comparable-service learning. `/api/workforce/exceptions` exposes only the manager-authorized active venue/window and `app/workforce-decision-queue.tsx` renders server rank, evidence and insufficient-evidence states in NL/EN. The final gate is binding this component to the planner’s live venue/week without regressing the existing actionable controls, then remote migration/authenticated acceptance. |
| NL/EN, responsive and accessibility | Partially implemented | Core authenticated planner is localized and responsive; full route/browser acceptance at four widths remains. |
| Remote RLS and Storage verification | Credential-test-blocked | Nine tests intentionally remain skipped without privileged test credentials. |
| WhatsApp provider delivery | Provider-blocked | Manual open/copy workflow must remain operational until provider credentials exist. |

Production stays on Sites v30 until every non-blocked row is accepted and the exact tested commit is deployed.
