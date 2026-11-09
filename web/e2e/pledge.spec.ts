import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Local box can set PLEDGE_SHOTS=/workspace/near_hackathon/shots_pledge; CI uses test-results. */
const SHOTS = process.env.PLEDGE_SHOTS || join(process.cwd(), "test-results", "pledge-shots");

async function shot(page: import("@playwright/test").Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

test.describe("Pledge dashboard", () => {
  test("preview at 1440x900 fits without vertical scroll", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop density");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pledge");
    await expect(page.getByTestId("pledge-page")).toBeVisible();
    await expect(page.getByTestId("pledge-preview-banner")).toContainText(/Preview/i);
    await expect(page.getByTestId("pledge-cta")).toBeDisabled();
    await expect(page.getByTestId("pledge-cta")).toHaveText(/Pledge launches after audit/);
    await expect(page.getByTestId("pledge-warn")).toContainText(/Whole account is collateral/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Borrow NEAR without publishing/);
    await expect(page.getByTestId("pledge-caps")).toContainText(/exit caps/);
    await expect(page.getByTestId("pledge-float-key")).toBeVisible();
    const metrics = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 8);
    await shot(page, "pledge_1440x900");
  });

  test("preview at 1280x800 fits without vertical scroll", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop density");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/pledge");
    await expect(page.getByTestId("pledge-widget")).toBeVisible();
    const metrics = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 8);
    await shot(page, "pledge_1280x800");
  });

  test("preview at 390 and morph to active chrome", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "mobile shot");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pledge");
    await expect(page.getByTestId("pledge-page")).toBeVisible();
    await shot(page, "pledge_390");
    await page.getByTestId("pledge-preview-morph").click();
    await expect(page.getByTestId("pledge-page")).toHaveClass(/is-active/);
    await expect(page.getByTestId("pledge-active")).toBeVisible();
    await shot(page, "pledge_active_390");
  });

  test("sidebar lists Pledge and marks it current", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "sidebar");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pledge");
    const link = page.getByTestId("app-nav-pledge");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("app-title")).toHaveText("Pledge");
  });
});
