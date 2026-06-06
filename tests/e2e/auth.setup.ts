import { expect, test as setup } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const authFile = path.join(__dirname, ".auth/admin.json");

setup("authenticate admin", async ({ page }) => {
  mkdirSync(path.dirname(authFile), { recursive: true });

  await page.route("**/api/auth/login", async (route) => {
    const headers = {
      ...route.request().headers(),
      "x-forwarded-for": `127.0.0.${Math.floor(Math.random() * 200) + 20}`,
    };
    await route.continue({ headers });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill("businessops.admin@yopmail.com");
  await page.getByLabel("Password").fill("Admin@1234");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: /Good to see you/i })).toBeVisible();
  await page.context().storageState({ path: authFile });
});
