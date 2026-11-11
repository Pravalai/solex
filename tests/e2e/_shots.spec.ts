import { test } from "@playwright/test";
const OUT = process.env.SHOTS_DIR!;
const PAGES = (process.env.SHOTS ?? "").split(",").filter(Boolean);
test("screens", async ({ page }) => {
  test.skip(!OUT, "manual screenshot helper");
  await page.setViewportSize({ width: Number(process.env.SHOTS_W ?? 1440), height: 1000 });
  await page.goto("/login");
  await page.getByTestId(`persona-${process.env.SHOTS_USER ?? "neha@solex.demo"}`).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  for (const p of PAGES) {
    await page.goto(p);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}/${p.replace(/[/?=&]/g, "_") || "home"}.png`, fullPage: true });
  }
});
