import { expect, test } from "@playwright/test";

const adminUrl = process.env.E2E_ADMIN_URL ?? "https://academic-api.anssoft.com.tr/admin/";

test("VPS admin login shell loads without Cloud Run traffic", async ({ page }) => {
  const consoleErrors: string[] = [];
  const cloudRunRequests: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes(".run.app")) cloudRunRequests.push(request.url());
  });

  const response = await page.goto(adminUrl, { waitUntil: "networkidle" });

  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  await expect(page).toHaveTitle("Akademik Takvim Admin");
  await expect(page.getByText("Akademik Takvim Yönetimi")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin Girişi" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Admin Paneline Gir" })).toBeVisible();
  await expect(page.locator('script[src^="/admin/assets/"]')).toHaveCount(1);

  expect(cloudRunRequests).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("favicon"))).toEqual([]);
});

test("VPS admin login shell fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(adminUrl, { waitUntil: "networkidle" });

  await expect(page.getByText("Akademik Takvim Yönetimi")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Admin Girişi" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
});
