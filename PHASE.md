# Current phase

**All phases complete.** The demo is built, tested end to end and documented.

## Where things are
- Run: [README.md](README.md) (`npm install && npm run demo:reset && npm run dev`)
- Report for soleX: [docs/REPORT.md](docs/REPORT.md)
- Live walkthrough: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

## Final verification
- `npm test`: 88 unit + integration tests pass
- `npm run test:e2e`: 9 journeys pass
- `npm run typecheck`, `npm run lint`, `npm run build`: clean
- Integrity checker: all 7 invariants pass on seeded data and after every journey

## Post-build additions
- Simulated sales calling from the lead page (`src/modules/calls/`): live call with transcript, rule-based summary and positive / negative / neutral insights, logged as a CALL interaction. No external APIs or AI.
- Action-first redesign: a task list per persona (`src/modules/reporting/queue.ts` + `components/app/action-queue.tsx`), calls end with one structured next action (schedule visit / send info / call back / nurture), template WhatsApp drafts, payment reminders, partner visit requests confirmed by the exec, best-fit units on the lead page. Analytics moved to the command centre's Performance tab; copy trimmed across all pages.

## Next (if the engagement continues)
Discovery on the open policy questions in REPORT §12, then the phasing in REPORT §13.

## Phase overview
| Phase | Status |
|---|---|
| 0 Setup | ✅ done |
| 1 Domain core | ✅ done |
| 2 Identity & shell | ✅ done |
| 3 Sales workflow UI | ✅ done |
| 4 Finance & Command Centre | ✅ done |
| 5 External portals | ✅ done |
| 6 E2E & hardening | ✅ done |
| 7 Report | ✅ done |
