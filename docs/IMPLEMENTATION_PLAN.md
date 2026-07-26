# Implementation plan

## Delivered launch slice

1. Establish a restrained nightlife-finance design system and public acquisition site.
2. Deliver a clearly labelled, credential-free synthetic demo with traceable operational views.
3. Implement mobile-first close entry and deterministic reconciliation.
4. Model tenant, venue, close snapshot, event, product cost, invoice, alert, audit and job records.
5. Implement and independently test the exact-money calculation contract.
6. Validate lint, types, unit tests, production build and representative routes.
7. Publish a private production version through Sites.

## Risks and controls

- Tenant leakage: organisation and venue keys are mandatory; all production handlers must bind actor membership.
- Financial drift: integer minor units, basis points and immutable snapshots.
- Document prompt injection: uploads are untrusted evidence, never instructions; extraction remains review-only.
- External dependency failure: integrations fail closed; deterministic demo and calculations remain available.
- Legal readiness: legal identity values must be configured and are never invented.

## Verification

`npm run verify` and `npm run test:e2e`.
