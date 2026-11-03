import { chromium } from "playwright";
const b = await chromium.launch();
for (const w of [1280, 390]) { const p = await b.newPage({ viewport: { width: w, height: 900 } }); await p.goto("http://localhost:3200/", { waitUntil: "networkidle" }); await p.waitForTimeout(1500);
  await p.screenshot({ path: `/workspace/near_hackathon/qa_design2/shots/walk-after/home-top-${w}.png` }); await p.close(); }
await b.close();
