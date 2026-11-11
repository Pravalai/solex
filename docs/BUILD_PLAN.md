# soleX Round 2 Demo — Build Plan

## Context

soleX (ShahX Buildcon / soleX Reality) runs an **exclusive sole-selling mandate** business. Developers appoint soleX to sell a project, or a defined part of its inventory. soleX then runs the whole sales operation: internal sales staff, marketing, brokers and channel partners, customers, collections and commissions. They are choosing a long-term technology partner, and Round 2 asks for a **small, tailored, working demo**. It is not the real operating system.

The repo (`C:\Antino\solex`) is empty: one commit, an empty `README.md`, and `docs/` with the two source PDFs. Everything is greenfield. Node 24 and npm 11 are installed.

**User decisions (confirmed):** a working full-stack app (not a clickable mock) · Next.js + TypeScript + Prisma + SQLite · presented from a local machine in a live session (no hosting).

### What soleX wants, and how they will judge it (from Demo Brief §7–9)
- A few **thoughtfully connected** screens, not many disconnected mockups. Screen count and lines of code are not the measure.
- Pick a manageable combination: management dashboard · project and inventory view · lead-to-booking workflow · broker or developer portal · financial workflow (booking to collections/commission).
- Mock data is fine, but state clearly **what is simulated and what actually works**. Use fictional data only, and list assumptions and limitations.
- Engineering write-up: stack and architecture (modular monolith vs microservices, with reasons), how entities relate, how inventory/bookings/finance stay consistent, how confidential data is separated, how the system grows.
- Evaluation criteria: understanding of the **mandate model (soleX ≠ broker)** · product thinking and workflows · design and usability · technical judgement and data architecture · integration across functions · security and transaction integrity · creativity and feasibility.
- Do **not** build the full platform, use paid integrations, or add production infrastructure.

### The core idea the demo must show
soleX manages **the project's whole sales operation under a mandate**, not individual listings. So the **Mandate** is a first-class entity at the centre of the data model. It holds the term, the appointed inventory, the commercial terms (soleX fee, broker payout, incentive, discount bands, earning trigger) and the absorption target. Every booking, collection and commission resolves back to a mandate. Dashboards report **mandate health** (absorption vs target, days remaining, fee earned vs receivable, broker cost and net margin), which a broker CRM would not.

---

## 1. Scope

### In scope: one "golden thread" across five personas
1. **Command Centre** (management): multi-mandate KPIs, a mandate-health table, the funnel, lead source and broker contribution, and an alerts and approvals queue. Every number drills down to the project, then the unit or booking.
2. **Project & Inventory**: the mandate summary plus a **stacking-plan grid** (tower × floor × unit), colour-coded by status. Units outside the mandate (developer-retained) are shown hatched. A unit drawer shows the price breakdown, the status/price history, and the hold and book actions.
3. **Lead → Booking workflow** (sales exec and manager): pipeline, lead detail and timeline, assignment, activity logging, site visit scheduling and completion, and booking with discount approval.
4. **Booking → Finance**: an auto-generated payment schedule, payment recording, commission accrual → earned → settled, and cancellation with inventory and financial reversal.
5. **Broker portal**: authorised projects only, available inventory, lead registration with attribution protection, own leads, bookings and commission statement. Mobile-responsive.
6. **Developer portal**: own projects only: inventory, bookings, collections, the soleX fee payable, the **discount-approval action for discounts beyond the mandate band**, and a CSV export of the reporting pack (MIS).
7. **Activity & integrity**: a global audit/event trail, a **simulated notification outbox** (WhatsApp/email shown, never sent), and a live **integrity check** (invariants that must always hold).

Why this set: it covers all five options in the brief through **one connected flow** rather than isolated screens. It also puts two external stakeholders (broker and developer) into the same records with different visibility, which demonstrates data separation and integrity at the same time.

### Explicitly out of scope (listed as future recommendations in the report)
Customer portal (the `Customer` entity exists, ready for it) · HR/payroll/attendance/leave · marketing campaign spend and ROI (lead source and campaign tags only) · real WhatsApp/SMS/email/payment gateway/Meta/Google/accounting integrations (simulated outbox only) · document management and KYC upload · broker self-registration/KYC approval flow (brokers are seeded as approved) · AI features (rule-based or LLM; proposed in the report) · native/PWA apps · bulk import/export (except the developer MIS CSV) · price revisions and the offers engine · global search and saved views · scheduled reports · configurable roles UI · MFA/SSO/password reset · CI/CD, cloud, backups, monitoring · GST/TDS on commissions.

---

## 2. Tech stack & architecture

| Concern | Choice | Why |
|---|---|---|
| App | **Next.js (App Router, latest stable) + React + TypeScript (strict)** | One deployable; Server Components for reads, Server Actions for mutations |
| Styling / components | **Tailwind CSS + shadcn/ui (Radix)** | Accessible primitives, owned component code, a fast route to a consistent design system |
| Charts | **Recharts** (via shadcn chart wrappers) | Light and good enough for KPI and funnel charts |
| ORM / DB | **Prisma + SQLite** (better-sqlite3 driver adapter if on Prisma 7) | Zero infrastructure for a local demo; the schema is Postgres-portable (production target) |
| Validation | **Zod** | Shared input schemas for actions and forms |
| Auth | **jose** (signed httpOnly JWT cookie) + **bcryptjs** | Real sessions without external services |
| Tests | **Vitest** (unit and integration on a temporary SQLite DB) + **Playwright** (E2E) | Covers domain rules, data scoping and the full UI flow |

Exact versions are pinned at install time (`npm install --save-exact`). Risk: if the native SQLite driver fails on Windows/Node 24, fall back to the libSQL adapter.

**Architecture: modular monolith.** At soleX's stage (one team, rapidly changing rules, strong cross-module consistency needs such as booking → inventory → schedule → commission in one atomic step), a modular monolith gives ACID transactions across modules without distributed sagas, plus one deployment and simpler operations. Module boundaries are enforced in code, so a module (for example notifications or reporting) can be split out later when scale demands it. The report gives this reasoning in full.

```
src/
  app/                         # UI routes only (thin)
    login/
    (internal)/                # management, sales, finance
      command-centre/  projects/[id]/  leads/  leads/[id]/
      bookings/[id]/  finance/  approvals/  activity/
    broker/                    # broker portal (own layout, mobile-first)
      page.tsx  projects/[id]/  leads/  commissions/
    developer/                 # developer portal
      page.tsx  projects/[id]/  approvals/  api/export (CSV)
    api/integrity/route.ts
  modules/                     # domain layer; no React imports
    identity/   (session, permissions map, scope builders, DTO projection)
    mandates/   (developers, projects, mandates, commercial terms)
    inventory/  (units, holds, pricing, unit state machine)
    crm/        (leads, activities, dedupe, assignment, site visits)
    sales/      (bookings, approvals, cancellation)
    finance/    (schedules, payments, commissions)
    reporting/  (dashboard read queries, integrity checks)
    audit/      (audit events, simulated notification outbox)
  lib/          (db client, withTx, money/format, errors, clock)
  components/   (design system: StatusBadge, Money, KpiCard, UnitGrid, Timeline…)
prisma/ schema.prisma, seed.ts
tests/ unit/ integration/ e2e/
docs/ BUILD_PLAN.md, REPORT.md, DEMO_SCRIPT.md
```
Rules: UI → Server Action → `authorize()` → Zod parse → module service inside `withTx()` → `revalidatePath`. Modules call each other only through exported service functions. Each business command runs as one DB transaction.

---

## 3. Data model (core entities)

```
Developer 1─* Project 1─* Mandate ─┐ (commercial terms snapshot source)
    │            │  1─* Tower 1─* Unit *─0..1 Mandate   (null = not appointed / developer-retained)
    │            └─ PaymentPlan 1─* PaymentPlanStage
    └─* User(role=DEVELOPER)
Broker 1─* User(role=BROKER) ; Broker *─* Project via BrokerProjectAccess
User(role=MGMT|SALES|FINANCE) *─* Project via EmployeeAllocation
Lead *─1 Project, *─0..1 Broker (attribution), *─1 User (assignee), 1─* LeadActivity, 1─* SiteVisit
Booking 1─1 Unit(active), *─1 Lead, *─1 Customer, *─1 Mandate, *─0..1 Broker, *─1 SalesExec
Booking 1─* Installment, 1─* Payment, 1─* Commission
AuditEvent (actor, type, entity, projectId, before/after) ; Notification (simulated outbox)
```

Key fields and rules:
- **Mandate**: code, start/end, status, `targetUnits`, `soleXFeeBps` (+ optional tier: a higher bps after N units), `brokerPayoutBps`, `incentiveBps`, `earningTriggerBps` (the collection % at which commissions become earned, e.g. 20%), discount bands `execMaxDiscountBps` / `mgmtMaxDiscountBps` (beyond that needs developer approval), `holdMinutes`, `attributionWindowDays`, `forfeitureBps`. The model allows several mandates per project (renewals or phases); the demo seeds one active mandate each.
- **Unit**: unitNo, floor, config, carpet/super area, facing, PLC, floor rise, `listPrice` (computed from project rate + components), `status` (AVAILABLE · HOLD · BLOCKED · BOOKED · SOLD), `holdById`/`holdExpiresAt`, `version` (optimistic lock), `mandateId?`.
- **Lead**: contact, `phoneNormalized`, budget, configuration preference, source (DIRECT/WEBSITE/META/GOOGLE/BROKER/WALK_IN/REFERRAL), campaign tag, `brokerId?`, `attributionExpiresAt`, assignee, stage (RFP §8.3 stages), nextFollowUpAt, `customerId?`.
- **Booking**: code, `unitLockKey String? @unique` (= unitId while active, null once cancelled; a database-level guard against double booking), `priceSnapshot` JSON, listPrice, discount, `agreementValue`, status (PENDING_MGMT_APPROVAL · PENDING_DEV_APPROVAL · CONFIRMED · AGREEMENT · CANCELLED), approvals, refundDue.
- **Installment**: seq, label, dueDate, amountDue, amountReceived, status (overdue is derived from the due date).
- **Payment**: amount, mode, `reference` (unique per booking, to prevent recording the same payment twice), allocated to installments in due order.
- **Commission**: kind (DEVELOPER_FEE = receivable to soleX · BROKER_PAYOUT and EMPLOYEE_INCENTIVE = payables), party, base, `rateBps` (snapshotted from the mandate at accrual), amount, status (ACCRUED → EARNED → INVOICED → RECEIVED for the fee; ACCRUED → EARNED → APPROVED → PAID for payouts; REVERSED), and an ADJUSTMENT row (negative) for clawbacks.
- **Money**: integer rupees; rates in basis points; deterministic rounding, with the last installment absorbing the remainder so the schedule sum equals the agreement value exactly.

---

## 4. Connected workflow (golden thread)

| # | Action (persona) | Service | Side effects in the same transaction |
|---|---|---|---|
| 1 | Broker registers lead (broker portal) | `crm.registerLead` | Dedupe on phone + project within the attribution window. A duplicate returns "already registered" without revealing who holds it. Locks attribution, auto-assigns to an allocated exec (round-robin), audit + simulated WhatsApp to the exec |
| 2 | Exec logs a call and schedules a site visit | `crm.logActivity`, `crm.scheduleVisit` | Lead stage → Contacted / Site visit planned; broker sees the status |
| 3 | Exec completes the visit with feedback | `crm.completeVisit` | Stage → Site visit completed; next follow-up set |
| 4 | Exec holds a unit, then books with a discount | `inventory.holdUnit`, `sales.createBooking` | Conditional unit update (version + status) → BOOKED, or HOLD-locked while pending approval. Booking inserted with `unitLockKey`. Customer created from lead. Lead → Booked |
| 5 | Discount beyond the exec band → management approves; beyond the mandate band → **developer approves in developer portal** | `sales.approveDiscount` | On final approval: CONFIRMED → schedule generated from the payment plan, commissions ACCRUED with rates snapshotted |
| 6 | Finance records payments | `finance.recordPayment` | Allocates to installments. When cumulative collection ≥ `earningTriggerBps`: booking → AGREEMENT, unit → SOLD, commissions → EARNED |
| 7 | Finance invoices the developer fee and approves/pays the broker payout | `finance.settleCommission` | Status transitions, audit |
| 8 | Dashboards everywhere update | `reporting.*` | Computed live from source tables: no duplicated counters to drift |
| alt | Management cancels a booking | `sales.cancelBooking` | Unit → AVAILABLE, `unitLockKey` → null, open installments cancelled, unpaid commissions REVERSED, paid ones clawed back via ADJUSTMENT, refund due = received − forfeiture |

---

## 5. Consistency & transaction integrity
1. **One transaction per business command** (`withTx`). Every side effect in the table above commits together or not at all.
2. **Optimistic locking**: `updateMany({ where: { id, version, status: in allowed } })`. If the count is not 1 → `ConflictError("Unit no longer available")`. Expired holds count as available (lazy expiry).
3. **Database backstop**: unique `Booking.unitLockKey`. A second active booking on the same unit is impossible even if application logic has a bug.
4. **Explicit state machines** (allowed-transition tables) for Unit, Lead, Booking, Installment and Commission. Illegal transitions throw `DomainError`.
5. **Snapshots**: the price breakdown and commission rates are frozen at booking/accrual, so later mandate or price edits never rewrite history.
6. **Idempotent payments** (unique booking + reference).
7. **Audit in the same transaction** for every material change (old/new values).
8. **Integrity checker** (`reporting.runIntegrityChecks`), shown on the Activity page and asserted in tests: each BOOKED/SOLD unit has exactly one active booking and the reverse · schedule sum = agreement value · Σ received = Σ payments · commission amount = base × rate · no commission on cancelled bookings unless reversed.

## 6. Confidential data separation
- **Surface gating** in middleware: `/broker/*` for BROKER only, `/developer/*` for DEVELOPER only, internal routes for MGMT/SALES/FINANCE.
- **Permission map** (role → actions such as `booking.create`, `discount.approve.mgmt`, `discount.approve.dev`, `payment.record`, `commission.settle`, `lead.reassign`, `booking.cancel`), checked server-side in every action.
- **Row scoping** applied centrally: `scope.projects(ctx)` and `scope.leads(ctx)` return Prisma `where` clauses. MGMT sees all. SALES sees allocated projects and own leads. BROKER sees accessible projects and **own** leads and bookings only. DEVELOPER sees **own developer's** projects only.
- **Field projection**: per-role DTO mappers. Brokers never see internal notes, discount bands, the soleX fee or other brokers. Developers see bookings, collections and the fee payable, but **not** broker payout amounts, the internal lead pipeline (aggregate funnel only), employee incentives or other developers. Customer phone numbers are masked outside the owning scope.
- Cross-tenant access by ID returns **404** (not 403), so the existence of other records is not leaked.

## 7. UI/UX direction
- Visual identity drawn from soleX's RFP cover: deep slate/navy (#2E3A46) with a muted gold accent (#A8884F), on a neutral light canvas. Inter, with tabular numbers for money. Indian formatting (₹1.25 Cr, ₹45.6 L, en-IN).
- A **single status colour language** used everywhere: Available (green) · Hold (amber, with countdown) · Blocked (grey) · Booked (blue) · Sold (navy) · Not in mandate (hatched).
- Internal: a collapsible sidebar with surface-specific navigation. Desktop-first command centre with a KPI strip, then the mandate-health table, then charts, then the alerts rail. Every KPI is a link.
- Broker portal: mobile-first (verified at 390 px), with large tap targets and the primary action ("Register lead") always visible.
- Demo affordances: a persona quick-switch on the login page, a "Demo data" banner, and **"Simulated" badges** on the outbox and any faked integrations. Toasts, confirm dialogs on irreversible actions, inline Zod errors, empty states.

## 8. Seed data (fictional, deterministic)
A seeded random generator plus dates relative to "now" give reproducible demos. `npm run demo:reset` reseeds.
- 2 developers (e.g. *Aravali Habitats*, *Meridian Realty*), 3 projects across 2 cities. One project has a tower **retained by the developer** (not in the mandate) to show appointed inventory.
- ~200 units, ~150 leads across sources, ~50 visits, ~25 bookings with payments spread over 6 months (so trends render), and some overdue installments and follow-ups (so alerts show).
- Personas (password `demo1234`): management director, 2 sales execs (different allocations), finance, 2 brokers (different project access), 2 developer users.

---

## 9. Phased milestones

Project control files: `CLAUDE.md` (living reference: summary, scope boundaries, stack, decisions, conventions, progress log) and `PHASE.md` (current phase, goals, status, next). Both are updated at the end of **every** phase. No git commits unless the user asks.

| Phase | Deliverables | Exit criteria |
|---|---|---|
| **0 Setup** | Scaffold Next.js/TS/Tailwind/shadcn/Prisma/Vitest/Playwright; `CLAUDE.md`, `PHASE.md`, `docs/BUILD_PLAN.md` (this plan); `.env.example`; npm scripts (`dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `demo:reset`) | `npm run dev` boots; typecheck and lint clean |
| **1 Domain core** | Prisma schema + migration; `lib/` (money, withTx, errors, clock); modules inventory/crm/sales/finance/audit services with state machines; seed script | Unit and integration tests green: pricing, schedule sums, commission calculation including tier and rounding, state transitions, **concurrent double booking → exactly one succeeds**, hold expiry, approval chain, payment → earned, cancellation reversal, payment idempotency |
| **2 Identity & shell** | Login, sessions, middleware gating, permission map, scope builders, DTO projections; app shell for the 3 surfaces; design-system components | Scope/IDOR integration tests green (broker A ≠ broker B, developer A ≠ developer B, sales exec limited to allocated projects); all personas log in and reach the right surface |
| **3 Sales workflow UI** | Projects list + stacking-plan grid + unit drawer; leads pipeline + detail + activity + visits; booking flow + booking detail | Manual run of steps 2–5 in the UI works, and a conflict shows a clear error |
| **4 Finance & Command Centre** | Finance page (collections, commission ledger and settlement); booking-detail finance tab; cancellation; approvals queue; command centre with drill-down; activity, outbox and integrity panel | Steps 6–8 and cancellation work in the UI; KPIs change after actions; integrity checks all pass |
| **5 External portals** | Broker portal (projects, inventory, lead registration with dedupe, own leads, commissions); developer portal (dashboard, bookings, collections, fee payable, discount approvals, CSV MIS) | Step 1 and the developer approval work end to end; field projection verified (no broker payout in developer views, no fee or other brokers in broker views); broker portal usable at 390 px |
| **6 E2E & hardening** | Playwright suites (below); fix defects; empty/error states; README run instructions | All test suites green; `npm run build` passes; fresh clone → `npm install && npm run demo:reset && npm run dev` works |
| **7 Report** | `docs/REPORT.md` (decisions + answers to soleX's engineering questions + Mermaid architecture/ER/sequence diagrams + simulated vs real + assumptions/limitations + brief gaps and proposals); `docs/DEMO_SCRIPT.md` (10–15 minute walkthrough) | Report covers every item in Step 7 of the request; CLAUDE.md/PHASE.md marked complete |

## 10. Testing strategy
- **Unit (Vitest)**: pure functions: price computation, schedule generation (sum invariant, rounding), commission calculation and tiers, state-machine transition tables, phone normalisation and dedupe, scope `where` builders.
- **Integration (Vitest + fresh temporary SQLite DB per file)**: services end to end against a real DB: `Promise.all` double booking (one success, one ConflictError, one active booking), stale-version conflict, hold expiry, approval routing by discount band, payment allocation and earned trigger, cancellation reversal and clawback, duplicate payment reference rejected, every role's scope and IDOR checks, DTO field leakage checks. `runIntegrityChecks()` is asserted after each scenario.
- **E2E (Playwright, against the seeded dev server)**:
  1. *Golden path*: broker registers lead → exec sees it assigned → logs call → schedules and completes visit → books unit with a discount beyond the mandate band → management approves → developer approves in the developer portal → grid shows BOOKED → finance records payments → booking AGREEMENT/unit SOLD, commissions EARNED → command centre KPIs reflect it → broker sees booking and commission → developer sees booking and fee but no broker payout.
  2. *Double booking*: two browser contexts hold and book the same unit → the second gets the conflict error.
  3. *Duplicate lead*: broker B registers broker A's lead → "already registered", with no details leaked.
  4. *Access control*: a broker or developer opening internal or other-tenant URLs gets a redirect or 404.
  5. *Cancellation*: unit back to AVAILABLE, commissions reversed, integrity checks pass.
- Quality gates per phase: `typecheck`, `lint`, `test`; Phase 6 adds `test:e2e` and `build`.

## 11. Verification (final acceptance)
1. `npm install && npm run demo:reset && npm run dev`, then open http://localhost:3000.
2. `npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build`: all green.
3. Walk `docs/DEMO_SCRIPT.md` manually across all 5 personas. Confirm the double-booking failure, the duplicate-lead protection, developer/broker visibility limits, and that the integrity panel shows all checks passing.
4. Any defect found is fixed and its test added before declaring completion.
