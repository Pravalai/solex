import { expect, test, type Page } from "@playwright/test";
import { newSession, openProject, toast } from "./helpers";

/**
 * The full connected flow from the demo brief, driven through the real UI by
 * five personas in separate browser sessions:
 * partner lead → exec call + site visit → booking with a large discount →
 * soleX approval → developer approval → inventory → collections → commission →
 * dashboards and portals.
 */
const CUSTOMER = "Kavya Raghavan";
const PHONE = "9876501234";
const EXEC_EMAIL: Record<string, string> = { "Arjun Mehta": "arjun@solex.demo", "Sara Thomas": "sara@solex.demo" };

function digits(text: string | null) {
  return Number((text ?? "").replace(/[^\d]/g, ""));
}

async function absorbedKpi(page: Page) {
  await page.goto("/command-centre");
  return digits((await page.getByTestId("kpi-absorbed").textContent())?.split("/")[0] ?? "");
}

test("lead → visit → booking → approvals → collections → commission → dashboards", async ({ browser }) => {
  // Baseline from the command centre.
  const neha = await newSession(browser, "neha@solex.demo");
  const absorbedBefore = await absorbedKpi(neha.page);

  // 1. Partner registers the customer from the broker portal.
  const rohan = await newSession(browser, "rohan@primeestates.demo");
  await rohan.page.goto("/broker");
  await rohan.page.locator("#projectId").selectOption({ label: "Aravali Greens" });
  await rohan.page.locator("#name").fill(CUSTOMER);
  await rohan.page.locator("#phone").fill(PHONE);
  await rohan.page.getByTestId("register-lead").click();
  await expect(toast(rohan.page).filter({ hasText: `${CUSTOMER} registered` })).toBeVisible();
  await rohan.page.goto("/broker/leads");
  await expect(rohan.page.getByTestId("broker-leads")).toContainText(CUSTOMER);

  // 2. The lead was auto-assigned to a sales exec allocated to the project.
  await neha.page.goto(`/leads?tab=ALL&q=${PHONE}`);
  await neha.page.getByText(CUSTOMER).first().click();
  await neha.page.waitForURL(/\/leads\/.+/);
  const leadUrl = neha.page.url();
  const ownerRow = neha.page.locator("dt", { hasText: "Owner" }).locator("xpath=following-sibling::dd[1]");
  const owner = (await ownerRow.textContent())!.trim();
  expect(Object.keys(EXEC_EMAIL)).toContain(owner);
  await expect(neha.page.getByRole("heading", { level: 1 }).locator("..")).toContainText("Partner: Prime Estates");

  // 3. The exec calls, schedules a visit and records its outcome.
  const exec = await newSession(browser, EXEC_EMAIL[owner]);
  const p = exec.page;
  await p.goto(leadUrl);
  await p.locator('select[name="type"]').selectOption("CALL");
  await p.getByTestId("activity-note").fill("Spoke to Kavya; wants a park-facing 3BHK, visiting with family");
  await p.getByTestId("log-activity").click();
  await expect(toast(p).filter({ hasText: "Activity logged." })).toBeVisible();
  await p.getByTestId("schedule-visit").click();
  await expect(toast(p).filter({ hasText: "Site visit scheduled" })).toBeVisible();
  await p.getByText("Record outcome").click();
  await p.getByTestId("visit-feedback").fill("Loved the clubhouse; prefers tower A upper floors");
  await p.getByTestId("complete-visit").click();
  await expect(toast(p).filter({ hasText: "Visit marked completed." })).toBeVisible();
  await expect(p.getByRole("heading", { level: 1 })).toContainText("Visit done");

  // 4. Book a unit for her from the stacking plan, with a 4.5% discount (beyond the 3% mandate band).
  await p.getByTestId("start-booking").click();
  await expect(p.getByTestId("booking-mode")).toContainText(CUSTOMER);
  const cell = p.locator("[data-testid^=unit-A-][data-status=AVAILABLE]").first();
  const unitNo = (await cell.getAttribute("data-testid"))!.replace("unit-", "");
  await cell.click();
  await expect(p.getByTestId("unit-drawer-title")).toContainText(unitNo);
  await expect(p.getByTestId("booking-lead")).toContainText(CUSTOMER);
  const listPrice = digits(await p.getByTestId("list-price").textContent());
  await p.getByTestId("booking-discount").fill(String(Math.round(listPrice * 0.045)));
  await expect(p.getByTestId("approval-preview")).toContainText("developer approval");
  await p.getByTestId("booking-submit").click();
  await p.waitForURL(/\/bookings\/.+/);
  await expect(p.getByRole("heading", { level: 1 })).toContainText("Awaiting soleX approval");
  const bookingUrl = p.url();
  const code = (await p.getByRole("heading", { level: 1 }).textContent())!.match(/BK-AGR-\d{4}/)![0];

  // The unit is locked meanwhile: nobody else can take it.
  await openProject(p, "AGR");
  await expect(p.getByTestId(`unit-${unitNo}`)).toHaveAttribute("data-status", "HOLD");

  // 5a. soleX management approves within its authority, which routes it to the developer.
  await neha.page.goto("/approvals");
  await neha.page.getByTestId(`approve-${code}`).click();
  await neha.page.getByTestId(`approve-${code}-confirm`).click();
  await expect(neha.page.getByTestId(`approval-${code}`)).toContainText("Waiting for the developer");

  // 5b. The developer gives the final approval in their own portal.
  const meera = await newSession(browser, "meera@aravali.demo");
  await meera.page.goto("/developer/approvals");
  await meera.page.getByTestId(`dev-approve-${code}`).click();
  await meera.page.getByTestId(`dev-approve-${code}-confirm`).click();
  await expect(meera.page.getByTestId(`dev-approval-${code}`)).toHaveCount(0);

  // Inventory now shows the unit booked, and a 5-instalment schedule exists.
  await openProject(p, "AGR");
  await expect(p.getByTestId(`unit-${unitNo}`)).toHaveAttribute("data-status", "BOOKED");

  // 6. Finance records the first two instalments, which crosses the 20% earning trigger.
  const vikram = await newSession(browser, "vikram@solex.demo");
  const f = vikram.page;
  await f.goto(bookingUrl);
  await expect(f.getByRole("heading", { level: 1 })).toContainText("Confirmed");
  for (const [seq, ref] of [
    [1, "UTR-E2E-0001"],
    [2, "UTR-E2E-0002"],
  ] as const) {
    const amount = digits(await f.getByTestId(`installment-${seq}`).locator("td").nth(3).textContent());
    await f.getByTestId("payment-amount").fill(String(amount));
    await f.getByTestId("payment-reference").fill(ref);
    await f.getByTestId("record-payment").click();
    await expect(f.getByTestId(`installment-${seq}`)).toContainText("Paid");
  }
  await expect(f.getByRole("heading", { level: 1 })).toContainText("Agreement stage");
  await expect(f.getByTestId("commission-DEVELOPER_FEE")).toHaveAttribute("data-status", "EARNED");
  await expect(f.getByTestId("commission-BROKER_PAYOUT")).toHaveAttribute("data-status", "EARNED");

  // The same bank reference cannot be recorded twice.
  await f.getByTestId("payment-amount").fill("1000");
  await f.getByTestId("payment-reference").fill("UTR-E2E-0002");
  await f.getByTestId("record-payment").click();
  await expect(f.getByTestId("form-error")).toContainText("already recorded");

  // Finance raises the soleX fee invoice to the developer.
  await f.getByTestId("settle-DEVELOPER_FEE").click();
  await f.getByPlaceholder("Invoice no.").fill("SX/INV/E2E/1");
  await f.getByTestId("settle-DEVELOPER_FEE-confirm").click();
  await expect(f.getByTestId("commission-DEVELOPER_FEE")).toHaveAttribute("data-status", "INVOICED");

  // 7. Command centre reflects the sale.
  expect(await absorbedKpi(neha.page)).toBe(absorbedBefore + 1);
  await expect(neha.page.getByTestId("action-queue")).not.toContainText(code);

  // 8. The partner sees the booking and their earned brokerage, but nothing internal.
  await rohan.page.goto("/broker/commissions");
  await expect(rohan.page.getByTestId("brokerage-lines")).toContainText(CUSTOMER);
  await expect(rohan.page.getByTestId("brokerage-lines")).toContainText("Earned: awaiting approval");
  await expect(rohan.page.locator("body")).not.toContainText("soleX fee");

  // 9. The developer sees the booking and the fee it owes, never the partner or brokerage.
  await meera.page.goto("/developer");
  await meera.page.getByRole("link", { name: "Aravali Greens" }).click();
  const row = meera.page.getByTestId(`dev-booking-${code}`);
  await expect(row).toContainText("Channel partner");
  await expect(row).toContainText("Agreement stage");
  await expect(meera.page.locator("body")).not.toContainText("Prime Estates");
  await expect(meera.page.locator("body")).not.toContainText(/brokerage/i);

  // 10. Integrity checks still hold across the whole database.
  await neha.page.goto("/activity");
  await expect(neha.page.getByTestId("integrity-status")).toContainText("All 7 integrity checks pass");

  for (const s of [neha, rohan, exec, meera, vikram]) await s.context.close();
});
