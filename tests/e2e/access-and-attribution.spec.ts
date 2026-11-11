import { expect, test } from "@playwright/test";
import { loginAs, newSession } from "./helpers";

test("a second partner cannot claim an already-registered customer, and learns nothing about who has it", async ({ page }) => {
  await loginAs(page, "ishita@urbankey.demo");
  await page.goto("/broker/leads");
  await page.locator("#projectId").selectOption({ label: "Aravali Greens" });
  await page.locator("#name").fill("Aditi Sharma");
  await page.locator("#phone").fill("+91 98100 12345"); // registered by Prime Estates in the seed
  await page.getByTestId("register-lead").click();
  const error = page.getByTestId("form-error");
  await expect(error).toContainText("already registered");
  await expect(error).not.toContainText(/Prime|AGR-L|Arjun|Sara/);
  await expect(page.getByTestId("broker-leads")).not.toContainText("Aditi Sharma");
});

test("each role is confined to its own surface and its own records", async ({ browser, request }) => {
  // Collect project ids as management.
  const neha = await newSession(browser, "neha@solex.demo");
  await neha.page.goto("/projects");
  const idOf = async (code: string) => (await neha.page.getByTestId(`project-${code}`).getAttribute("href"))!.split("/").pop()!;
  const msk = await idOf("MSK");
  const agr = await idOf("AGR");

  // Broker: internal screens bounce back to the partner portal; unauthorised project is a 404.
  const rohan = await newSession(browser, "rohan@primeestates.demo");
  await rohan.page.goto("/command-centre");
  await expect(rohan.page).toHaveURL(/\/broker$/);
  await rohan.page.goto(`/projects/${agr}`);
  await expect(rohan.page).toHaveURL(/\/broker$/);
  const brokerMsk = await rohan.page.goto(`/broker/projects/${msk}`);
  expect(brokerMsk?.status()).toBe(404);

  // Developer: cannot open internal pages, another developer's project, or export its MIS.
  const meera = await newSession(browser, "meera@aravali.demo");
  await meera.page.goto("/bookings");
  await expect(meera.page).toHaveURL(/\/developer$/);
  expect((await meera.page.goto(`/developer/projects/${msk}`))?.status()).toBe(404);
  const exportOther = await meera.context.request.get(`/developer/export?project=${msk}`);
  expect(exportOther.status()).toBe(404);
  const exportOwn = await meera.context.request.get(`/developer/export?project=${agr}`);
  expect(exportOwn.status()).toBe(200);
  const csv = await exportOwn.text();
  expect(csv.split("\r\n")[0]).toContain("Agreement value");
  expect(csv).not.toMatch(/Prime Estates|UrbanKey|Westside/);

  // Sales exec allocated only to MSK cannot open AGR.
  const rohit = await newSession(browser, "rohit@solex.demo");
  expect((await rohit.page.goto(`/projects/${agr}`))?.status()).toBe(404);
  await rohit.page.goto("/command-centre");
  await expect(rohit.page).toHaveURL(/\/leads$/);

  // No session at all: redirected to sign in; the CSV endpoint is not reachable either.
  const anon = await request.get(`/developer/export?project=${agr}`, { maxRedirects: 0 });
  expect([302, 307]).toContain(anon.status());

  for (const s of [neha, rohan, meera, rohit]) await s.context.close();
});
