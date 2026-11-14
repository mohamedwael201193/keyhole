import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Local box can set PLEDGE_SHOTS=/workspace/near_hackathon/shots_pledge; CI uses test-results. */
const SHOTS = process.env.PLEDGE_SHOTS || join(process.cwd(), "test-results", "pledge-shots");

async function shot(page: import("@playwright/test").Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

async function noHorizontalOverflow(page: import("@playwright/test").Page) {
  const metrics = await page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test.describe("Loans showcase", () => {
  test("desktop 1440x900 shows both settled loans, timelines, costs, live state", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "desktop density");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pledge");
    await expect(page.getByTestId("pledge-page")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Borrow against your key/);
    await expect(page.getByTestId("loans-hero")).toContainText(/Two real loans on NEAR mainnet/);
    await expect(page.getByTestId("loan-card-a")).toContainText("REPAID");
    await expect(page.getByTestId("loan-card-b")).toContainText("DEFAULTED");
    await expect(page.getByTestId("loan-card-b")).toContainText(/Key transferred to lender/);
    await expect(page.getByTestId("loans-timeline-a").locator("li")).toHaveCount(7);
    await expect(page.getByTestId("loans-timeline-b").locator("li")).toHaveCount(5);
    await expect(page.getByTestId("loans-timeline-a")).toContainText(/Fund — first try failed/);
    await expect(page.getByTestId("loans-costs")).toContainText("0.1 NEAR");
    await expect(page.getByTestId("loans-costs")).toContainText("0.0032 NEAR");
    await expect(page.getByTestId("loans-value-history")).toContainText("0.213652 USDC");
    await expect(page.getByTestId("loans-reserves")).toContainText(/not a live on-chain balance/);
    await expect(page.getByTestId("loans-live-state")).toBeVisible();
    await expect(page.getByTestId("loans-footer")).toContainText(/Borrowing from the browser opens in a later release/);
    await expect(page.getByTestId("pledge-page")).not.toContainText(/Example — preview|lender-demo\.near|Pledge launches after audit/);
    await noHorizontalOverflow(page);
    await shot(page, "loans_1440x900");
  });

  test("mobile 390x844 stacks the loans without horizontal overflow", async ({ page }, info) => {
    test.skip(info.project.name !== "mobile", "mobile shot");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/pledge");
    await expect(page.getByTestId("pledge-page")).toBeVisible();
    await expect(page.getByTestId("loan-card-a")).toBeVisible();
    await expect(page.getByTestId("loan-card-b")).toBeVisible();
    await expect(page.getByTestId("loans-costs")).toBeVisible();
    await noHorizontalOverflow(page);
    await shot(page, "loans_390");
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
