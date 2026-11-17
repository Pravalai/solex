# soleX Mandate Sales OS: Round 2 demo

A small, **working** prototype of the operating system soleX needs to run exclusive sole-selling mandates. One connected flow runs across five stakeholders: a channel partner registers a buyer, a soleX sales exec works the lead and books a unit, discounts are approved by soleX and (beyond the mandate band) by the developer, inventory updates, a payment schedule is generated, collections trigger commission, and the command centre, partner portal and developer portal each reflect it, showing only what that role may see.

All people, companies, projects and numbers are **fictional**. WhatsApp/email/SMS messages, payments and sales calls are **simulated**.

Sales execs can **call a customer from the lead page**. The call plays as a live call with a running transcript. On hang-up it is summarised, positive / negative / neutral insights are extracted, and it is logged on the lead timeline with a follow-up date. No telephony, speech-to-text or AI service is used: the conversation is generated deterministically from the lead and project, and the analysis is rule-based (`src/modules/calls/`).

- What was built and why, plus answers to the engineering questions: [docs/REPORT.md](docs/REPORT.md)
- Architecture on one page (layers, module dependencies, end-to-end flow, data model, linked status changes, double-booking protection, data separation): [docs/architecture.html](docs/architecture.html), open it in a browser
- 10–15 minute walkthrough for the live demo: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)
- Build plan: [docs/BUILD_PLAN.md](docs/BUILD_PLAN.md)

## Run it

Requirements: Node.js 22+ (tested on Node 24, Windows 11) and npm 10+. No database server or external accounts are needed.

```bash
npm install          # also generates the Prisma client
npm run demo:reset   # creates prisma/dev.db and seeds ~6 months of fictional history (~45 s)
npm run dev          # http://localhost:3000
```

Sign in from the login page by clicking any persona (password `demo1234`):

| Persona | Role | Lands on |
| --- | --- | --- |
| Neha Kapoor | soleX management | Command centre |
| Arjun Mehta / Sara Thomas / Rohit Kulkarni | soleX sales (different project allocations) | My leads |
| Vikram Rao | soleX finance | Collections & commission |
| Rohan Desai (Prime Estates) · Ishita Sen (UrbanKey) · Kunal Joshi (Westside) | Channel partners | Partner portal |
| Meera Iyer (Aravali Habitats) · Sameer Patil (Meridian Realty) | Developers | Developer portal |

Run `npm run demo:reset` again at any time to return to the same starting data. If you change `prisma/schema.prisma` in a way that cannot be applied in place, delete `prisma/dev.db` first.

Optional: copy `.env.example` to `.env` to set your own `SESSION_SECRET` (a development fallback is used otherwise).

## Tests

```bash
npm test             # 88 unit + integration tests (Vitest, each file on a fresh SQLite copy)
npm run test:e2e     # 9 Playwright journeys against the real app (reseeds first)
npm run typecheck && npm run lint && npm run build
```

The first E2E run needs a browser: `npx playwright install chromium`.

## Stack

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 + shadcn/ui · Prisma 7 on SQLite (Postgres-ready schema) · jose sessions · Zod · Recharts · Vitest · Playwright. Architecture: a modular monolith (`src/modules/*`). See the report for the reasoning.
