import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("cancelling a booking releases the unit and reverses or claws back commission", async ({ page }) => {
  await loginAs(page, "neha@solex.demo");
  await page.goto("/bookings?tab=LIVE");
  // Pick an agreement-stage booking so settled commission has to be clawed back.
  const row = page.locator("tr", { hasText: "Agreement stage" }).first();
  await row.locator("a").first().click();
  await page.waitForURL(/\/bookings\/.+/);
  const unitLink = page.getByRole("link", { name: /^[A-Z]+\d*-\d+$/ }).first();
  const unitNo = (await unitLink.textContent())!.trim();

  await page.getByTestId("cancel-booking").click();
  await page.locator("#reason").fill("Customer withdrew (E2E)");
  await page.getByTestId("cancel-booking-confirm").click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Cancelled");
  await expect(page.getByText(/Refund due ₹/)).toBeVisible();
  for (const kind of ["DEVELOPER_FEE", "BROKER_PAYOUT", "EMPLOYEE_INCENTIVE"]) {
    const line = page.getByTestId(`commission-${kind}`);
    if ((await line.count()) === 0) continue;
    const status = await line.getAttribute("data-status");
    // Unsettled lines are reversed; settled ones stay settled and get a clawback line.
    if (status !== "REVERSED") await expect(page.getByTestId(`commission-${kind}-adj`)).toBeVisible();
  }

  await unitLink.click();
  await expect(page.getByTestId("unit-drawer-title")).toContainText(unitNo);
  await expect(page.getByTestId("unit-drawer-title")).toContainText("Available");

  await page.goto("/activity");
  await expect(page.getByTestId("integrity-status")).toContainText("All 6 integrity checks pass");
});
