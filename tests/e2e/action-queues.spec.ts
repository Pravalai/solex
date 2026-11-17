import { expect, test } from "@playwright/test";
import { newSession, toast } from "./helpers";

/**
 * Each persona lands on a short task list and resolves items in place:
 * the exec schedules the visit a customer agreed to on a call, a partner's
 * visit request reaches the exec and is confirmed, and finance records an
 * overdue receipt straight from its queue.
 */
const EXEC_EMAIL: Record<string, string> = { "Arjun Mehta": "arjun@solex.demo", "Sara Thomas": "sara@solex.demo", "Rohit Kulkarni": "rohit@solex.demo" };

test("sales exec schedules a promised visit from the task list", async ({ browser }) => {
  const arjun = await newSession(browser, "arjun@solex.demo");
  const p = arjun.page;
  await p.goto("/leads");
  const item = p.locator('[data-testid="queue-item"][data-item^="call-visit-"]').first();
  const leadId = (await item.getAttribute("data-item"))!.replace("call-visit-", "");
  await expect(item).toContainText("Agreed to a site visit");
  await item.getByTestId("queue-schedule").click();
  await item.getByTestId("queue-visit-save").click();
  await expect(toast(p).filter({ hasText: "Site visit scheduled" })).toBeVisible();

  // The promise is kept, so the item turns into "visit tomorrow, call to confirm".
  await expect(p.locator(`[data-item="call-visit-${leadId}"]`)).toHaveCount(0);
  await expect(p.locator(`[data-item="visit-due-${leadId}"]`)).toContainText("Site visit tomorrow");
  await arjun.context.close();
});

test("a partner's visit request reaches the exec, is confirmed, and the partner sees it", async ({ browser }) => {
  const rohan = await newSession(browser, "rohan@primeestates.demo");
  await rohan.page.goto("/broker/leads");
  const eligible = rohan.page.getByTestId("broker-leads").locator("> div").filter({ has: rohan.page.getByTestId("request-visit") }).first();
  const name = (await eligible.locator(".font-medium").first().textContent())!.trim();
  const phone = (await eligible.locator(".text-muted-foreground").first().textContent())!.split(" · ")[1].trim();
  // Pin the card by phone: it stops matching "has a request button" once the button is clicked.
  const card = rohan.page.getByTestId("broker-leads").locator("> div").filter({ hasText: phone });
  await card.getByTestId("request-visit").click();
  await card.getByTestId("request-visit-send").click();
  await expect(toast(rohan.page).filter({ hasText: "Visit requested" })).toBeVisible();

  // Find who owns the lead (management can see everyone's).
  const neha = await newSession(browser, "neha@solex.demo");
  await neha.page.goto(`/leads?tab=ALL&q=${phone}`);
  await neha.page.getByRole("link", { name }).first().click();
  await neha.page.waitForURL(/\/leads\/.+/);
  const owner = (await neha.page.locator("dt", { hasText: "Owner" }).locator("xpath=following-sibling::dd[1]").textContent())!.trim();

  const exec = await newSession(browser, EXEC_EMAIL[owner]);
  await exec.page.goto("/leads?all=1");
  const item = exec.page.locator('[data-testid="queue-item"][data-item^="visit-request-"]').filter({ hasText: name });
  await expect(item).toContainText("Prime Estates asked for a site visit");
  await item.getByTestId("queue-confirm-visit").click();
  await item.getByTestId("queue-visit-save").click();
  await expect(toast(exec.page).filter({ hasText: "Visit confirmed" })).toBeVisible();

  await rohan.page.goto("/broker");
  await expect(rohan.page.getByTestId("broker-updates")).toContainText("Site visit scheduled");
  await expect(rohan.page.getByTestId("broker-updates")).toContainText(name);
  for (const s of [rohan, neha, exec]) await s.context.close();
});

test("finance records an overdue receipt and sends a reminder from the queue", async ({ browser }) => {
  const vikram = await newSession(browser, "vikram@solex.demo");
  const f = vikram.page;
  await f.goto("/finance");
  const items = f.locator('[data-testid="queue-item"][data-item^="collect-"]');
  const first = items.first();
  const firstId = await first.getAttribute("data-item");
  await first.getByTestId("queue-record-payment").click();
  await first.getByTestId("queue-payment-ref").fill("UTR-QUEUE-0001");
  await first.getByTestId("queue-payment-save").click();
  await expect(toast(f).filter({ hasText: "Payment recorded" })).toBeVisible();
  await expect(f.locator(`[data-item="${firstId}"]`)).toHaveCount(0);

  const next = items.first();
  await next.getByTestId("queue-remind").click();
  await expect(toast(f).filter({ hasText: "Reminder sent" })).toBeVisible();
  await expect(next).toContainText("Reminded today");
  await expect(next.getByTestId("queue-remind")).toHaveCount(0);

  await f.goto("/activity");
  await expect(f.getByTestId("integrity-status")).toContainText("All 7 integrity checks pass");
  await vikram.context.close();
});
