# NightProfit

NightProfit is an evidence-backed financial control and profit-intelligence product for bars, nightclubs and event venues. This repository contains the public site, a clearly labelled synthetic interactive demo, mobile-first reconciliation, event/margin/invoice/import/alert/report views, an exact-money calculation core and a D1/R2 persistence model.

## Architecture

Vinext renders React App Router routes to a Cloudflare Worker. D1 owns relational records; private uploads belong in R2. Authoritative calculations use integer minor units and basis points in `lib/calculations.ts`. See `docs/ARCHITECTURE.md`, `docs/CALCULATION_CONTRACT.md` and `docs/SECURITY.md`.

## Prerequisites

- Node.js 22.13 or newer
- npm
- A Sites deployment for managed D1/R2 bindings
- Optional OpenAI, Stripe and Resend accounts for production adapters

## Local setup

```bash
npm ci
cp .env.example .env
npm run dev
```

Open `http://localhost:3000`. The public site is at `/`; the credential-free synthetic demo is at `/demo`.

## Environment

Copy `.env.example`. The demo and calculation tests need no external credentials. For production, configure the relevant values in the hosting runtime, never in client-side variables.

- OpenAI: key plus extraction/briefing model names. Invoice data is sent only for organisations that enable AI.
- Stripe: secret, webhook signing secret and price IDs. Verify events at the server and store event IDs idempotently.
- Resend: API key and verified sender.
- Cron: a high-entropy `CRON_SECRET`.
- Legal: company, address, legal/privacy/support email. Launch is blocked until these are genuine.

## Database and files

The logical D1 binding is `DB`; private R2 documents use `DOCUMENTS`. Generate schema migrations with:

```bash
npm run db:generate
```

Apply generated migration files using the hosting platform’s D1 migration flow. Never point reset commands at production. The synthetic demo does not seed or overwrite customer data.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run verify
```

## Production deployment

1. Configure authenticated access and runtime secrets in Sites.
2. Confirm legal configuration, privacy text and support ownership.
3. Apply the reviewed D1 migration and create the private R2 binding.
4. Configure Stripe webhook delivery and a Vercel/hosting-compatible daily cron route when those adapters are enabled.
5. Run `npm run verify`.
6. Save and deploy the validated version through Sites.
7. Smoke-test `/`, `/demo`, `/app/dashboard` and the close workflow.

## Backups and recovery

Enable provider-managed D1 backups and R2 versioning/retention appropriate to legal obligations. Quarterly, restore a backup into a non-production tenant and verify close snapshots, audit hashes and private document access. Never restore over live production without a reviewed recovery plan.

## Troubleshooting

- Build engine warning: install Node 22.13+.
- Missing D1/R2: verify `.openai/hosting.json` and hosted bindings.
- Integration disabled: check the server-only key and entitlement; the app must fail closed.
- Financial disagreement: preserve the record and compare its immutable snapshot against `docs/CALCULATION_CONTRACT.md`.

## Launch checklist

- `npm run verify` passes on Node 22.13+.
- D1 migration applied and private R2 access verified.
- Authentication and server-side membership/role enforcement tested with two organisations.
- Stripe, Resend, OpenAI and cron tested only if enabled.
- Legal company/privacy/support configuration complete.
- Backup restore tested.
- Security headers, upload limits, webhook replay protection and rate limits verified.
- No integration is marketed as live until its credentialed end-to-end test passes.
