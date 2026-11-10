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
    await expect(page.getByTestId("pledge-preview-banner")).toContainText(/Example|preview/i);
    await expect(page.getByTestId("pledge-cta")).toBeDisabled();
    await expect(page.getByTestId("pledge-cta")).toHaveText(/Pledge launches after audit/);
    await expect(page.getByTestId("pledge-warn")).toContainText(/Whole account is collateral/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Borrow NEAR without publishing/);
    await expect(page.getByTestId("pledge-caps")).toContainText(/exit caps/);
    await expect(page.getByTestId("pledge-float-key")).toBeVisible();
    await expect(page.getByTestId("pledge-floor")).toHaveText("0.50");
    await expect(page.getByTestId("pledge-borrow")).toHaveValue("0.01");
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

for(const [project,width,height,label] of [["desktop",1440,900,"1440x900"],["mobile",390,844,"390"]] as const){
 test(`lender ${label}: public floor is declared until sealed verification`,async({page},info)=>{
  test.skip(info.project.name!==project,"matching viewport");
  await page.setViewportSize({width,height});
  const privateRequests:string[]=[];
  page.on("request",r=>{if(/\/api\/worker/.test(r.url()))privateRequests.push(r.postData()??"");});
  await page.goto("/pledge/lend/example");
  await expect(page.getByTestId("lender-page")).toBeVisible();
  await expect(page.getByText("Declared, not yet verified",{exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Verify sealed certificate",exact:true})).toBeDisabled();
  await expect(page.getByRole("button",{name:"Funding disabled pending release review",exact:true})).toBeDisabled();
  await expect(page.getByText(/Whole account is collateral/)).toBeVisible();
  expect(privateRequests).toEqual([]);
  await shot(page,`lender_${label}`);
 });
}
