import { expect, test } from "@playwright/test";
import { newSession, toast } from "./helpers";

/**
 * Simulated click-to-call from the lead page: the exec places a call, watches
 * the live transcript, and on hang-up gets a summary with positive / negative /
 * neutral insights that is logged on the lead timeline. Management can review
 * the call but not place one.
 */
const CUSTOMER = "Rhea Kapoor";

test("sales exec calls a lead: live transcript → summary and insights → logged on the timeline", async ({ browser }) => {
  const arjun = await newSession(browser, "arjun@solex.demo");
  const p = arjun.page;

  // A fresh lead, so this is its first call (first calls always connect).
  await p.goto("/leads");
  await p.getByTestId("new-lead").click();
  await p.locator("#projectId").selectOption({ label: "Aravali Greens" });
  await p.locator("#name").fill(CUSTOMER);
  await p.locator("#phone").fill("9876507788");
  await p.getByRole("button", { name: "Create lead" }).click();
  await p.waitForURL(/\/leads\/[^/?]+$/);
  const leadUrl = p.url();

  await p.getByTestId("call-lead").click();
  await expect(p.getByTestId("call-status")).toContainText("Connected", { timeout: 20_000 });
  await expect(p.getByTestId("call-line").first()).toContainText("Rhea");
  await p.getByTestId("call-skip").click();

  // The outcome leads with key points and one suggested next step; the full summary is a click away.
  const outcome = p.getByTestId("call-outcome");
  await expect(outcome).toBeVisible();
  await expect(outcome.getByTestId("keypoint").first()).toBeVisible();
  await expect(outcome.getByTestId("next-action-label")).not.toBeEmpty();
  await expect(p.getByTestId("call-summary")).toContainText("Spoke with Rhea");
  await expect(toast(p).filter({ hasText: "Call summarised" })).toBeVisible();
  await p.getByTestId("call-done").click();

  // Logged on the lead timeline as a compact call card, with the next step offered on the page.
  const card = p.getByTestId("call-card").first();
  await expect(card).toContainText("Spoke with Rhea");
  await expect(card.getByTestId("keypoint").first()).toBeVisible();
  await expect(p.getByTestId("next-action")).toBeVisible();

  // Management reviews the call but has no call button.
  const neha = await newSession(browser, "neha@solex.demo");
  await neha.page.goto(leadUrl);
  await expect(neha.page.getByTestId("call-card").first()).toContainText("Spoke with Rhea");
  await expect(neha.page.getByTestId("call-lead")).toHaveCount(0);

  await neha.page.goto("/activity");
  await expect(neha.page.getByTestId("integrity-status")).toContainText("All 7 integrity checks pass");
});
