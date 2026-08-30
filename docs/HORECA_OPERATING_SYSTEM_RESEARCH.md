# HORECA operating-system research

Research date: 28 July 2026. This is a product decision document, not a claim that every capability below already exists in NightProfit.

## Owner jobs and recurring operational load

Dutch horeca owners repeatedly translate uncertain covers and events into staffing, purchasing and preparation; collect employee availability; repair last-minute roster gaps; receive deliveries; reconcile invoice and contract prices; count stock; explain waste and cash differences; approve hours; and close the trading night. The costliest preventable mistakes are disconnected versions of truth: overstaffing or understaffing, stockouts and over-ordering, unchallenged supplier price changes, incorrect recipe margins, duplicate receipts or invoices, unapproved hours, missing deposits and unexplained close differences.

Weekly control should therefore follow one evidence chain:

`Demand → roster and prep → order → receipt → stock movement → service and attendance → close → variance → assigned action`

## Competitor capability matrix

| Product | Primary-source capability pattern | Product lesson for NightProfit |
|---|---|---|
| [MaestroPlanner](https://maestroplanner.nl/) | Availability requests and roster sharing through WhatsApp; shift swaps | Communication is part of the roster command, with a safe fallback when delivery is unconfigured |
| [Eitje](https://www.eitje.app/tools/) | Templates, open shifts, swaps, availability deadlines, labor cost, revenue forecast, mobile editing, hour approval | Workforce planning needs employee self-service and labor feedback, not a shift list |
| [Horeko](https://horeko.com/) | Kitchen management and personnel planning positioned for horeca operations | Domain workflows should share venue and trading-date context |
| [Apicbase](https://get.apicbase.com/) | Recipes, inventory, purchasing, COGS, demand-based suggested orders and three-way matching | Product, recipe, purchasing and inventory records must form one governed chain |
| [MarketMan](https://www.marketman.com/platform) | Mobile inventory, purchasing/receiving, recipe costing, price-change visibility and multi-unit control | Mobile execution and actual-versus-theoretical reporting are launch-critical |
| [MarginEdge](https://www.marginedge.com/) | Invoice processing, food-cost visibility and operational accounting workflows | Human-reviewed document extraction should feed discrepancy actions |
| [Lightspeed Restaurant](https://www.lightspeedhq.com/pos/restaurant/) | POS operations, payments, reporting and integrations | POS is an adapter/source; NightProfit should not pretend to replace certified payment execution |
| [SevenRooms](https://sevenrooms.com/platform/) | Reservations, guest profiles, marketing and venue operations | Bookings must influence demand while consent and guest data remain purpose-limited |
| [Restaurant365](https://www.restaurant365.com/) | Accounting, workforce, inventory and operations across locations | Financial control requires approvals, auditability and multi-location governance |
| [Deputy](https://www.deputy.com/features) / [Planday](https://www.planday.com/features/) | Scheduling, time attendance, availability, leave and communication | Manager and employee journeys must close the loop through approved time |

## NightProfit differentiation

NightProfit should win on evidence-backed profit control for nightlife and event-led venues: trading dates that cross midnight, event contribution, deposits, organizer economics, labor and beverage margin in one nightly close, and recommendations that link to exact source records. AI proposes and explains; deterministic server calculations and approved snapshots remain authoritative.

## Prioritized workflow map

1. Workforce execution: demand intervals → availability → draft roster → publication → acknowledgement → attendance approval.
2. Product margin: supplier → product/unit conversion → effective cost → recipe → simulated selling price → approved margin snapshot.
3. Stock and purchasing: par/forecast → PO → partial receipt → append-only movements → count → variance approval.
4. Night close: revenue/payment evidence + labor + theoretical usage + count variance → approval → immutable learning snapshot.
5. Connected actions and governed AI proposals across those four loops.

## Required integrations

Launch adapters: POS sales/payment totals, reservation and ticketing demand, transactional email, WhatsApp Business, supplier catalogue/invoice input, private object storage and payroll export. Weather and public-event feeds may enrich demand later. Every connector needs credential validation, health state, idempotent ingestion, source provenance and a non-deceptive disconnected state.

## Legal, privacy and operational risks

- GDPR purpose limitation, minimization, retention, access/export and deletion handling for employee and guest data.
- Dutch working-time, break, youth-work and contract rules require configurable warnings and qualified legal review; software must not present warnings as legal advice.
- Allergens and HACCP data need accountable human verification.
- WhatsApp/email communications need lawful basis, approved templates where required, delivery evidence and opt-out handling.
- Invoice extraction and AI-generated proposals are untrusted until reviewed; hostile documents require isolation and prompt-injection defenses.
- Cross-tenant or cross-venue leakage, service-role exposure, mutable financial history and duplicate material commands are release-blocking risks.

## Commercial release boundary

Launch-critical: secure owner onboarding; venue/role isolation; demand-to-roster; employee self-service; product/recipe margin; PO/receipt/stock ledger/count; nightly close; action queue; NL/EN parity for representative journeys; remote adversarial authorization tests; mobile browser acceptance.

Deliberately later: autonomous pricing or purchasing, autonomous disciplinary decisions, payroll calculation, certified accounting, payment-terminal replacement, advanced table management/CRM, voice counting, broad marketplace integrations and statistical forecasting before sufficient clean history exists.
