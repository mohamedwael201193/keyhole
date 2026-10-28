import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e", timeout: 60_000, retries: 1, reporter: [["list"]],
  use: { baseURL: process.env.BASE_URL || "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } } },
  ],
});
