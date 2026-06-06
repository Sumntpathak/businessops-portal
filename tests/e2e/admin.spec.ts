import { expect, test, type Page } from "@playwright/test";

const admin = {
  email: "businessops.admin@yopmail.com",
  password: "Admin@1234",
};

function uniqueId() {
  return Date.now().toString(36);
}

function uniqueName(prefix: string) {
  const letters = uniqueId().replace(/[0-9]/g, (digit) => "abcdefghij"[Number(digit)] ?? "x");
  return `${prefix} ${letters}`.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function expectNoFrameworkError(page: Page) {
  await expect(page.getByText("Unhandled Runtime Error")).toHaveCount(0);
  await expect(page.getByText("Application error")).toHaveCount(0);
  await expect(page.getByText("Internal Server Error")).toHaveCount(0);
}

async function openNavigationIfCollapsed(page: Page) {
  const dashboardLink = page.getByRole("link", { name: "Dashboard", exact: true });
  if (!(await dashboardLink.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Open navigation" }).click();
  }
}

function navLink(page: Page, name: string) {
  return page.locator("nav").getByRole("link", { name, exact: true });
}

test.describe("Admin portal E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /Good to see you/i })).toBeVisible();
  });

  test("admin can access dashboard and primary navigation", async ({ page }) => {
    await openNavigationIfCollapsed(page);
    await expect(navLink(page, "Dashboard")).toBeVisible();
    await expect(navLink(page, "Leads")).toBeVisible();
    await expect(navLink(page, "Invoices")).toBeVisible();
    await expect(navLink(page, "Users")).toBeVisible();
    await expect(navLink(page, "Audit logs")).toBeVisible();
    await expect(navLink(page, "Settings")).toBeVisible();

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "New lead", exact: true }).click();
    await expect(page).toHaveURL(/\/leads\/new$/);

    await page.goto("/dashboard");
    await page.getByRole("link", { name: "New invoice", exact: true }).click();
    await expect(page).toHaveURL(/\/invoices\/new$/);
    await expectNoFrameworkError(page);
  });

  test("admin can create, search, open, and update a lead follow-up", async ({ page }) => {
    const id = uniqueId();
    const leadName = uniqueName("Playwright Lead");
    const email = `playwright.lead.${id}@yopmail.com`;

    await page.goto("/leads/new");
    await page.getByLabel("Full name *").fill(leadName);
    await page.getByLabel("Company").fill("Playwright QA");
    await page.getByLabel("Email *").fill(email);
    await page.getByLabel("Phone").fill("9876543210");
    await page.getByLabel("Notes").fill("Created by Playwright admin E2E test.");
    await page.getByRole("button", { name: "Create lead" }).click();

    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: leadName })).toBeVisible();
    await expect(page.getByRole("link", { name: /Create Invoice/i })).toBeVisible();

    await page.getByRole("button", { name: /Add follow-up/i }).click();
    await page.getByLabel("Action Note").fill("Follow up from Playwright test");
    await page.getByRole("button", { name: "Add Action" }).click();
    await expect(page.getByText("Follow up from Playwright test")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByText("Marked as Completed")).toBeVisible();

    await page.goto("/leads");
    await page.getByLabel("Search leads").fill(leadName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(leadName)).toBeVisible();
    await expectNoFrameworkError(page);
  });

  test("admin can create invoice and use browser share actions", async ({ page, context }) => {
    const clientName = uniqueName("Playwright Invoice Client");

    await page.goto("/invoices/new");
    await page.getByLabel("Client name *").fill(clientName);
    await page.getByLabel("Description").fill("Automation Billing Review");
    await page.getByLabel("Qty").fill("2");
    await page.getByLabel("Unit price (Rs)").fill("1250");
    await page.getByRole("button", { name: "Create invoice" }).click();

    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { name: /INV-/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: clientName })).toBeVisible();
    await expect(page.getByText("Digital Signature")).toBeVisible();
    await expect(page.getByRole("button", { name: /Email/i }).first()).toBeVisible();

    const popupPromise = context.waitForEvent("page");
    await page.getByRole("button", { name: /WhatsApp/i }).first().click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/wa\.me|whatsapp/i);
    await popup.close();

    await page.goto("/invoices");
    await page.getByLabel("Search invoices").fill(clientName);
    await page.keyboard.press("Enter");
    await expect(page.getByText(clientName)).toBeVisible();
    await expectNoFrameworkError(page);
  });

  test("admin can configure invoice setup and see settings tabs", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: /Invoice Setup/i }).click();
    await expect(page.getByRole("heading", { name: /Invoice Template & GST Defaults/i })).toBeVisible();

    await page.getByLabel("Default GST Tax (%)").fill("18");
    await page.getByLabel("Invoice Template Title").fill("Tax Invoice");
    await page.getByLabel("Standard Template Note").fill("Payment is due as per agreed terms.");
    await page.getByLabel("Signature Name").fill("Admin Signatory");
    await page.getByLabel("Designation").fill("Authorized Signatory");
    await page.getByRole("button", { name: "Save invoice setup" }).click();
    await expect(page.getByText("Invoice setup saved")).toBeVisible();

    await page.getByRole("button", { name: /Integrations/i }).click();
    await expect(page.getByText("Email / SMTP Configuration")).toBeVisible();
    await expect(page.getByText("WhatsApp Business Configuration")).toBeVisible();
    await expect(page.getByText("Payment Gateway Configuration")).toBeVisible();

    await page.getByRole("button", { name: /User Controls/i }).click();
    await expect(page.getByText("Permissions")).toBeVisible();
    await expectNoFrameworkError(page);
  });

  test("admin can create a user and open permissions", async ({ page }) => {
    const id = uniqueId();
    const userName = uniqueName("Playwright User");
    const email = `playwright.user.${id}@yopmail.com`;

    await page.goto("/users");
    await page.getByRole("button", { name: "Invite user" }).click();
    await page.getByLabel("Full name *").fill(userName);
    await page.getByLabel("Email *").fill(email);
    await page.getByLabel("Password *").fill("Agent@1234");
    await page.getByRole("button", { name: "Create user" }).click();
    await expect(page.getByText("User created")).toBeVisible();

    await page.getByLabel("Search users").fill(email);
    await expect(page.getByText(email)).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: email });
    await row.getByRole("button", { name: "Permissions" }).click();
    await expect(page.getByText(`Permissions for ${userName}`)).toBeVisible();
    await expect(page.getByText("Send Emails")).toBeVisible();
    await expectNoFrameworkError(page);
  });

  test("admin can inspect audit logs", async ({ page }) => {
    await page.goto("/audit-logs");
    await expect(page.getByRole("heading", { name: /Audit Logs/i })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Action" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: /LOGIN_SUCCESS|LEAD_CREATED|INVOICE_CREATED|PASSWORD_RESET_REQUESTED/ }).first()).toBeVisible();
    await expectNoFrameworkError(page);
  });
});

test.describe("Public auth flows", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("forgot-password exposes dev reset path for admin account", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill(admin.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("link", { name: "Reset password" })).toBeVisible();
  });
});

test("mobile admin shell opens navigation drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Good to see you/i })).toBeVisible();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(navLink(page, "Settings")).toBeVisible();
  await expect(navLink(page, "Invoices")).toBeVisible();
});
