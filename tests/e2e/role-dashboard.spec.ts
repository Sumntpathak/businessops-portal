import { expect, test, type Page } from "@playwright/test";

type RoleAccount = {
  email: string;
  hiddenNav: string[];
  label: RegExp;
  password: string;
  visibleNav: string[];
};

const accounts: Record<string, RoleAccount> = {
  manager: {
    email: "businessops.manager@yopmail.com",
    password: "Manager@1234",
    label: /Manager pipeline desk/i,
    visibleNav: ["Dashboard", "Leads", "Follow-ups", "Invoices", "Users", "Audit logs", "Settings"],
    hiddenNav: [],
  },
  agent: {
    email: "businessops.agent1@yopmail.com",
    password: "Agent@1234",
    label: /Agent work queue/i,
    visibleNav: ["Dashboard", "Leads", "Follow-ups", "Invoices", "Settings"],
    hiddenNav: ["Users", "Audit logs"],
  },
  finance: {
    email: "businessops.finance@yopmail.com",
    password: "Finance@1234",
    label: /Finance billing desk/i,
    visibleNav: ["Dashboard", "Leads", "Invoices", "Settings"],
    hiddenNav: ["Follow-ups", "Users", "Audit logs"],
  },
};

async function login(page: Page, account: RoleAccount) {
  await page.route("**/api/auth/login", async (route) => {
    const headers = {
      ...route.request().headers(),
      "x-forwarded-for": `127.10.${Math.floor(Math.random() * 200) + 20}.${Math.floor(Math.random() * 200) + 20}`,
    };
    await route.continue({ headers });
  });

  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function openNavigationIfCollapsed(page: Page) {
  const dashboardLink = page.getByRole("link", { name: "Dashboard", exact: true });
  if (!(await dashboardLink.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
}

test.describe("Role-specific dashboards and navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const [role, account] of Object.entries(accounts)) {
    test(`${role} sees role-focused dashboard and allowed navigation`, async ({ page }) => {
      await login(page, account);
      await expect(page.getByText(account.label)).toBeVisible();
      await expect(page.getByText("Internal Server Error")).toHaveCount(0);

      await openNavigationIfCollapsed(page);
      for (const item of account.visibleNav) {
        await expect(page.getByRole("link", { name: item, exact: true })).toBeVisible();
      }
      for (const item of account.hiddenNav) {
        await expect(page.getByRole("link", { name: item, exact: true })).toHaveCount(0);
      }
    });
  }
});
