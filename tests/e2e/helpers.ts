import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "demo1234";

export async function loginAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByTestId(`persona-${email}`).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function newSession(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, email);
  return { context, page };
}

export async function openProject(page: Page, code: string) {
  await page.goto("/projects");
  await page.getByTestId(`project-${code}`).click();
  await page.waitForURL(/\/projects\/[^/?]+/);
}

/** Opens the drawer for a unit and waits for it. */
export async function openUnit(page: Page, unitNo: string) {
  await page.getByTestId(`unit-${unitNo}`).click();
  await expect(page.getByTestId("unit-drawer-title")).toContainText(unitNo);
}

export async function chooseFirstLead(page: Page) {
  await page.getByTestId("booking-lead").click();
  await page.getByRole("option").first().click();
}

export function toast(page: Page) {
  return page.locator("[data-sonner-toast]");
}
