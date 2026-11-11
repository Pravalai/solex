import { expect, test } from "@playwright/test";
import { chooseFirstLead, newSession, openProject, openUnit } from "./helpers";

test("two execs racing for the same unit: exactly one booking succeeds", async ({ browser }) => {
  const sara = await newSession(browser, "sara@solex.demo");
  const arjun = await newSession(browser, "arjun@solex.demo");

  // Both open the same available unit at the same time.
  for (const s of [sara, arjun]) {
    await openProject(s.page, "AGR");
  }
  const unitNo = await sara.page.locator("[data-testid^=unit-B-][data-status=AVAILABLE]").first().getAttribute("data-testid");
  const target = unitNo!.replace("unit-", "");
  await openUnit(sara.page, target);
  await openUnit(arjun.page, target);
  await chooseFirstLead(sara.page);
  await chooseFirstLead(arjun.page);

  // Sara books first.
  await sara.page.getByTestId("booking-submit").click();
  await sara.page.waitForURL(/\/bookings\//);
  await expect(sara.page.getByText("Confirmed").first()).toBeVisible();

  // Arjun's view is now stale: the server rejects it with a clear message.
  await arjun.page.getByTestId("booking-submit").click();
  await expect(arjun.page.getByTestId("form-error")).toContainText(/changed since you opened it|no longer available/);

  // After refresh the unit shows as booked for Arjun too.
  await arjun.page.reload();
  await expect(arjun.page.getByTestId(`unit-${target}`)).toHaveAttribute("data-status", "BOOKED");

  await sara.context.close();
  await arjun.context.close();
});
