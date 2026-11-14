import { test, expect } from "@playwright/test";

test("landing primary CTA launches the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("start-cta")).toHaveAttribute("href", "/dashboard");
});
test("/start redirects to the dashboard checklist", async ({ page }) => {
  await page.goto("/start");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("setup-checklist")).toBeVisible();
});
test("signed-out new visitor: /start and /dashboard never loop back to /start", async ({ page }) => {
  // A fresh Playwright context carries no wallet and no storage: the new-visitor state.
  // /start redirects everyone to /dashboard, so /dashboard must NOT send a signed-out visitor
  // back to /start, or a new visitor would loop forever.
  await page.goto("/start");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("setup-checklist")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByTestId("setup-checklist")).toBeVisible();
});
test("/start?step=connect shows the first step and progress dots without a wallet", async ({ page }) => {
  await page.goto("/start?step=connect");
  await expect(page.getByTestId("start-connect")).toBeVisible();
  await expect(page.getByTestId("start-dots").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("start-dots").locator("li[aria-current=step]")).toContainText("Get started");
});
test("/start?step=connect fits 390px without horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/start?step=connect");
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(390);
});
test("P1: landing hash and proof links, verify label, key help, gallery traits", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("hash-stat")).toHaveAttribute("href", "/verify/path");
  // Ask, Atlas and Identity live in the footer's Proof & docs group, not the top bar.
  for (const href of ["/ask", "/atlas", "/identity"]) await expect(page.locator(`footer a[href="${href}"]`)).toHaveCount(1);
  await page.goto("/key");
  await expect(page.getByTestId("key-help")).toBeVisible();
  await page.goto("/gallery");
  await page.getByTestId("traits-explain").locator("summary").click();
  await expect(page.getByTestId("traits-explain")).toContainText("Bit cipher");
});
test("/start step 1: Google, email code, then wallets (when the Privy app is configured)", async ({ page }) => {
  await page.goto("/start?step=connect");
  const all = page.getByTestId("start-connect");
  await expect(all).toBeVisible();
  await expect(page.getByTestId("start-near")).toBeVisible();
  const social = page.getByTestId("start-social");
  if (await social.count()) {
    await expect(social).toHaveText("Continue with Google");
    await expect(page.getByTestId("start-email")).toHaveText("Continue with email");
    await expect(all).toHaveText("MetaMask and other wallets");
    const order = await page.locator('[data-testid="start-social"],[data-testid="start-email"],[data-testid="start-connect"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(order).toEqual(["start-social", "start-email", "start-connect"]);
    // Click again until hydrated; the Privy modal (Google + email) must open.
    await expect(async () => { await social.click(); await expect(page.locator("#privy-modal-content")).toBeVisible({ timeout: 5_000 }); }).toPass({ timeout: 30_000 });
  }
});
test("/start back from Google: Privy mounts by itself and shows 'Finishing Google sign-in'", async ({ page }) => {
  await page.goto("/start?step=connect");
  if (!(await page.getByTestId("start-social").count())) return; // Privy not configured in this build
  const privyReq = page.waitForRequest((r) => /privy\.io/.test(r.url()), { timeout: 20_000 });
  await page.goto("/start?step=connect&privy_oauth_state=x&privy_oauth_provider=google&privy_oauth_code=y");
  await expect(page.getByTestId("start-finishing")).toBeVisible({ timeout: 15_000 });
  await privyReq;
});
