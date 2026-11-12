import { expect, test } from "@playwright/test";

// The personal dashboard: every section a holder uses is a section of /dashboard, chosen by the hash. No wallet is needed to see
// that the sections open in place, that the developer material is not on the dashboard, and that the old routes still work.
test.describe("dashboard sections", () => {
  test("the sidebar opens each section inside /dashboard without a page load", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "sidebar");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-section", "overview");
    await page.evaluate(() => { (window as unknown as { __kept: boolean }).__kept = true; });
    for (const [id, testid, section] of [["swap", "swap-page", "swap"], ["vault", "vault-page", "vault"], ["activity", "activity-page", "activity"], ["proof", "my-proof", "proof"]] as const) {
      await page.getByTestId(`app-nav-${id}`).click();
      await expect(page.getByTestId("workspace")).toHaveAttribute("data-section", section);
      await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(`app-nav-${id}`)).toHaveAttribute("aria-current", "page");
      expect(new URL(page.url()).pathname).toBe("/dashboard");
    }
    // The same document the whole time: the sections were client navigation, not page loads.
    expect(await page.evaluate(() => (window as unknown as { __kept?: boolean }).__kept)).toBe(true);
  });

  test("a link inside a section to another section stays in the dashboard", async ({ page }) => {
    await page.goto("/dashboard#vault");
    await expect(page.getByTestId("vault-page")).toBeVisible({ timeout: 20_000 });
    await page.goto("/dashboard#swap");
    await expect(page.getByTestId("swap-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("swap-view-all").click();
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-section", "activity");
    expect(new URL(page.url()).pathname).toBe("/dashboard");
  });

  test("the dashboard carries no developer material, and Developers is one link away", async ({ page }, info) => {
    await page.goto("/dashboard#activity");
    await expect(page.getByTestId("activity-page")).toBeVisible({ timeout: 20_000 });
    for (const id of ["agent", "agent-quotas", "agent-policy", "agent-down", "agent-partial"]) await expect(page.getByTestId(id)).toHaveCount(0);
    await expect(page.getByText(/Agent API|holder-cap policy/i)).toHaveCount(0);
    if (info.project.name === "desktop") {
      await page.getByTestId("app-developers").click();
      await expect(page).toHaveURL(/\/developers$/);
      await expect(page.getByTestId("developers-page")).toBeVisible();
      await expect(page.getByTestId("agent")).toBeVisible();
    }
  });

  test("the old routes still work and light the right item", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "sidebar");
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const [path, testid, nav] of [["/swap", "swap-page", "swap"], ["/vault", "vault-page", "vault"], ["/settle", "activity-page", "activity"]] as const) {
      await page.goto(path);
      await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId(`app-nav-${nav}`)).toHaveAttribute("aria-current", "page");
    }
  });

  test("My proof does not verify a sample when there is no call yet", async ({ page }) => {
    await page.goto("/dashboard#proof");
    await expect(page.getByTestId("my-proof")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("verify-btn")).toHaveCount(0);
  });

  test("the back button returns to the previous section, forward goes back", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "sidebar");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard#swap");
    await expect(page.getByTestId("swap-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("app-nav-vault").click();
    await expect(page.getByTestId("vault-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-section", "vault");
    await page.goBack();
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-section", "swap");
    await expect(page.getByTestId("swap-page")).toBeVisible();
    expect(new URL(page.url()).hash).toBe("#swap");
    await page.goForward();
    await expect(page.getByTestId("workspace")).toHaveAttribute("data-section", "vault");
    expect(new URL(page.url()).hash).toBe("#vault");
  });

  test("the swap amount and the activity range survive leaving the section", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "sidebar");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/dashboard#swap");
    await expect(page.getByTestId("swap-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("swap-amount-input").fill("0.42");
    await expect(page.getByTestId("swap-amount-input")).toHaveValue("0.42");
    await page.getByTestId("app-nav-activity").click();
    await expect(page.getByTestId("activity-page")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("act-range").selectOption("7d");
    await expect(page.getByTestId("act-range")).toHaveValue("7d");
    await page.getByTestId("app-nav-swap").click();
    await expect(page.getByTestId("swap-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("swap-amount-input")).toHaveValue("0.42");
    await page.getByTestId("app-nav-activity").click();
    await expect(page.getByTestId("activity-page")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("act-range")).toHaveValue("7d");
  });
});

test("the /try mainnet toggle opens the dashboard, not the landing page", async ({ page }) => {
  await page.goto("/try");
  await page.getByTestId("net-mainnet").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("workspace")).toBeVisible({ timeout: 20_000 });
});

test("a price check clears its error when the amount is cleared", async ({ page }) => {
  await page.route("**/api/oneclick", (r) => (r.request().method() === "POST" ? r.fulfill({ json: { ok: false, error: { code: "no_quote" } } }) : r.fallback()));
  await page.goto("/dashboard#activity");
  await page.getByTestId("dry-btn").click();
  await expect(page.getByTestId("dry-msg")).toBeVisible();
  await page.getByTestId("oc-amount").locator("input").fill("");
  await expect(page.getByTestId("dry-msg")).toHaveCount(0);
});
