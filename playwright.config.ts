import { defineConfig, devices } from "@playwright/test";

/**
 * E2E suites drive the real app against a freshly seeded demo database.
 * They share one database, so they run serially in a fixed order.
 */
export default defineConfig({
  testDir: "tests/e2e",
  // _*.spec.ts are manual helpers (e.g. screenshots), not part of the suite.
  testIgnore: process.env.SHOTS_DIR ? [] : ["**/_*.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
