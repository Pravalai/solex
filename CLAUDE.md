# soleX Round 2 Demo: project reference

@AGENTS.md

Living reference for this repo. Update the **Progress log** at the end of every phase. The full plan is in [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md); the current phase is in [PHASE.md](PHASE.md).

## Summary
A small, working evaluation demo for **soleX** (ShahX Buildcon / soleX Reality), a real estate company running an **exclusive sole-selling mandate** business. Developers appoint soleX to sell a project or part of its inventory. soleX coordinates internal sales, marketing, brokers and channel partners, customers, collections and commissions.

The demo shows **one connected flow across five personas**: a broker registers a lead → sales exec works it (calls, site visit) → books a unit (with discount approval up to the developer) → inventory updates → payment schedule is generated → payments recorded → commissions accrue, become earned, and are settled → the command centre, broker portal and developer portal all reflect it, each seeing only what it may.

Source documents: [docs/soleX R2 Demo Brief.pdf](docs/) (what to build, how it is judged) and the RFP / Scope of Work (background reference only).

## Scope boundaries
**In:** command centre · project and inventory (stacking plan) · lead → visit → booking workflow · discount approval (management → developer) · payment schedule and collections · commission ledger (developer fee receivable, broker payout and employee incentive payables) · cancellation with reversal · broker portal · developer portal (+ CSV MIS) · audit trail, simulated notification outbox, live integrity checks.

**Out (future recommendations only):** customer portal · HR/payroll/attendance · marketing spend/ROI · real WhatsApp/SMS/email/payment/Meta/Google/accounting integrations · document/KYC management · broker self-registration · AI features · native/PWA apps · bulk import/export · price revisions · global search · scheduled reports · role-editor UI · MFA/SSO · CI/CD/cloud/backups · GST/TDS.

If something is tempting but not in scope, leave it out and add it to the report's recommendations.

## Tech stack
- Next.js 16.4 (App Router; **Cache Components off**, `proxy.ts` instead of middleware), React 19, TypeScript strict
- Tailwind CSS v4 + shadcn/ui (radix-nova preset; `cn` from the `cn` package via `@/lib/utils`), lucide icons, Recharts, sonner toasts
- Prisma 7.10 (`prisma-client` generator → `src/generated/prisma`, better-sqlite3 driver adapter) on SQLite (`prisma/dev.db`)
- jose (signed session cookie) + bcryptjs · Zod for action input
- Vitest (unit + integration on per-file temporary SQLite copies) · Playwright (E2E)
- npm 11 `allowScripts` in package.json approves native install scripts (better-sqlite3, prisma, esbuild)

## Commands
| Command | Purpose |
|---|---|
| `npm run demo:reset` | Generate client, recreate DB, seed fictional demo data |
| `npm run dev` | Start the app at http://localhost:3000 |
| `npm test` | Unit + integration tests (Vitest) |
| `npm run test:e2e` | Playwright end-to-end suites (reseeds the demo DB first; in Git Bash set `MSYS_NO_PATHCONV=1` for the screenshot helper) |
| `npm run typecheck` / `npm run lint` / `npm run build` | Quality gates |

## Architecture (modular monolith)
```
src/app/            UI routes only (thin): (internal)/, broker/, developer/, login/
src/modules/        domain layer, no React
  identity/         actor, permission matrix, row scopes, DTO projection
  inventory/        pricing, unit state machine, holds, optimistic lock
  crm/              leads, dedupe/attribution, assignment, activities, visits
  sales/            bookings, discount approvals, cancellation
  finance/          schedule/commission maths, payments, commission ledger
  reporting/        dashboard read models, integrity checks
  audit/            audit events + simulated notification outbox
src/lib/            db + withTx, clock, money, errors, state machine helper, formatting
prisma/             schema.prisma, seed.ts
tests/              unit/, integration/, e2e/, fixtures.ts
```

## Key decisions
1. **Mandate is first-class.** Commercial terms (fee + tier, broker payout, incentive, discount bands, earning trigger, hold time, attribution window, forfeiture) live on the Mandate; units with `mandateId = null` are developer-retained and unsellable by soleX.
2. **Money = integer rupees, rates = basis points.** Schedules use `splitByBps`, with the last instalment absorbing rounding.
3. **Integrity:** every command runs in one `withTx`. Unit changes go only through `transitionUnit` (version + state guard via `updateMany`, so a count ≠ 1 raises a ConflictError). `Booking.unitLockKey @unique` is the DB backstop. State machines are explicit tables. Price and commission rates are snapshotted. Payments are unique per (booking, reference).
4. **Confidentiality:** `assertCan` (permission matrix) + `*Scope(actor)` Prisma where-clauses + DTO projection; cross-tenant ids return NotFound. Developers never see broker payouts or incentives; brokers see only their own leads, bookings and commissions and only appointed inventory.
5. **Approval chain:** discount ≤ exec band → auto; ≤ management band → soleX management; above → management then developer. The pending booking holds the unit with `HOLD` + `holdExpiresAt = null` (an approval lock).
6. **Earning trigger:** when collections reach `earningTriggerBps` of agreement value, the booking moves to AGREEMENT, the unit to SOLD, and commissions to EARNED.
7. **Assumption:** broker payouts and incentives are paid by soleX out of its developer fee, so net margin per mandate = fee − payouts − incentives.
8. **Clock injection** (`@/lib/clock`) for tests and for the seed, which replays six months of history through the real services so seeded data obeys every rule.
9. Cache Components disabled: all screens are request-time and permission-scoped.

## Conventions
- Services take `actor` first and call `assertCan` before anything else; they never import `next/*`.
- Server Actions: `requireActor()` → Zod parse → service → `revalidatePath` → return `{ ok, message | error }`.
- Errors: `DomainError` (rule), `ConflictError` (lost race), `ForbiddenError`, `NotFoundError` (also used for out-of-scope).
- Compose data scope with `{ AND: [filter, xScope(actor)] }`, never by spreading (keys collide).
- Every material change calls `recordEvent(tx, …)` inside the same transaction; outbound messages go through `notify(tx, …)` (simulated).
- Write long files with the editor tool, not bash heredocs (heredocs containing backticks broke once).
- Read `node_modules/next/dist/docs/` before using a Next.js API you are unsure of (v16 has breaking changes).

## Progress log
- **Phase 0 (done):** scaffolded Next 16.4 / Tailwind v4 / shadcn radix-nova / Prisma 7.10 + better-sqlite3 / Vitest / Playwright; configs and scripts; plan copied to docs.
- **Phase 1 (done):** schema + domain services (inventory, crm, sales, finance, audit, integrity); deterministic seed replaying ~870 historical events through the services (181 leads, 29 bookings, all integrity checks pass); 27 unit + integration tests green. `demo:reset` uses non-destructive `prisma db push` (Prisma blocks `--force-reset` from AI agents); the seed wipes and recreates its own rows.
- **Phase 2 (done):** jose session cookie + `proxy.ts` surface gating + `requireActor` DAL; role-projected read models (inventory, leads, bookings); login with persona quick-switch; internal/broker/developer shells; brand tokens and status colour system. Access tests caught a scope-merge bug (`{ id, ...scope }` let the scope override `id`); every scoped query now uses `{ AND: [filter, scope] }`. 37 tests green.
- **Phase 3 (done):** projects list, project page (mandate terms panel + stacking plan + URL-driven unit drawer with hold/release/book and live approval preview), leads pipeline (agenda, funnel strip, filters, new-lead dialog with duplicate link), lead detail (log activity, stage, reassign, visits schedule/complete/no-show, attribution card, start-booking mode), bookings list + booking detail (approval stepper, schedule, ledger with settle buttons, receipts, audit trail). Playwright set up; double-booking E2E (two browser sessions) passes. Fixes: `minmax(0,1fr)` grid columns; constants exported from `"use client"` files become client references in server components, so shared class strings live in `components/app/styles.ts`; navigate from the action wrapper when the page refresh unmounts the form.
- **Phase 4 (done):** command centre (6 KPIs, mandate-health table with pace marker and health flag, stacked booking-value trend with a CVD-validated brand palette (AGC #3b64a8 / AGR #b07f2c / MSK #2a9d8f, slots fixed by project code), funnel, source and partner tables, sales team, attention rail); finance (collections, refunds, commission ledger with segregated approve/settle steps, clawbacks shown as recoveries); approvals queue; activity (audit trail, simulated outbox, live integrity panel).
- **Phase 5 (done):** partner portal (mobile-first home, register-a-customer with protected attribution, authorised projects with collapsed availability and price list, own customers, brokerage statement) and developer portal (portfolio, project inventory incl. retained units, bookings with channel only, fee statement, over-band discount approvals, CSV MIS export with formula-injection guard and an audit event).
- **Phase 6 (done):** 5 Playwright journeys (golden path across 5 personas, double booking in two browsers, duplicate partner registration, access control incl. CSV export, cancellation) + 37 Vitest tests; lint/typecheck/build clean; fresh-copy `npm install && npm run demo:reset && npm test` verified. Fix: ActionForm now toasts when the action resolves, not in an effect (forms that disappear after success lost their feedback). README written; branded 404.
- **Phase 7 (done):** docs/REPORT.md (decisions, engineering answers, diagrams, real vs simulated, assumptions, limitations, brief gaps, phasing) and docs/DEMO_SCRIPT.md. **Project complete.**
- **Post-build:** docs/architecture.html, a one-page visual architecture explainer (8 figures: layers, module dependencies, lead-to-commission swimlane, data model, linked state machines, double-booking race, access checks, cause→effect table). Removed the empty `src/modules/mandates` folder (mandate terms live in the schema and are read by inventory/sales/finance).
