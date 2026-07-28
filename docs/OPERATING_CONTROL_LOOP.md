# NightProfit operating control loop

NightProfit is not a collection of dashboards. It is a closed operational loop:

1. **Demand** combines bookings, events, manager input and later verified POS, reservation and weather sources.
2. **Plan** converts expected guests and revenue into service intervals and operating assumptions.
3. **Staff** schedules named or open shifts with availability, role and hourly-cost constraints.
4. **Buy** turns the same demand into stock requirements and checks supplier terms and invoices.
5. **Run** records attendance, handovers, incidents and exceptions during service.
6. **Close** reconciles money and source evidence using immutable, versioned snapshots.
7. **Learn** compares forecast with outcome and produces evidence-linked actions for the next cycle.

## Intelligence contract

- PostgreSQL calculations and immutable snapshots remain the financial source of truth.
- Rules identify deterministic risks such as open shifts, labor percentage, missing deposits and close differences.
- AI may propose a roster, summarize evidence, draft a booking reply or explain a discrepancy.
- Every material AI proposal has its inputs, rationale and evidence stored and requires an authorized human decision.
- AI never changes prices, schedules, deposits, invoices, staff records or closes without an explicit approved action.
- Confidence is only shown when it has a measurable basis; missing history is shown as missing data.

## Workforce planning scope

The planning workspace implements the verified MaestroPlanner workflow—availability collection, roster creation, open shifts and swaps, and WhatsApp distribution—but connects it to NightProfit demand and margin data. WhatsApp sending is activated only after a Business provider, approved templates, consent basis and webhook are credential-tested.

## Tenant and staff-data boundary

All planning records carry `organisation_id`; venue records additionally carry `venue_id`. Composite foreign keys prevent cross-tenant staff references. RLS checks venue assignment and capability for every read and mutation. Restricted HR and payroll data does not belong in the scheduling model; NightProfit stores only the operational fields required to plan and verify a service.

## Integration order

1. CSV/manual import and manager inputs.
2. Reservation and POS read adapters.
3. WhatsApp Business availability and schedule messages.
4. Time-clock and payroll export adapters.
5. Purchasing and stock integrations.

No adapter is shown as connected until its credentials and webhook or sync behavior pass an acceptance test.
