# Current phase

**All phases complete.** The demo is built, tested end to end and documented.

## Where things are
- Run: [README.md](README.md) (`npm install && npm run demo:reset && npm run dev`)
- Report for soleX: [docs/REPORT.md](docs/REPORT.md)
- Live walkthrough: [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

## Final verification
- `npm test`: 37 unit + integration tests pass
- `npm run test:e2e`: 5 journeys pass
- `npm run typecheck`, `npm run lint`, `npm run build`: clean
- Integrity checker: all 6 invariants pass on seeded data and after every journey

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
