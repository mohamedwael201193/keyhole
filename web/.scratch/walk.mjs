import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const [base, tag] = process.argv.slice(2);
const pages = ["/", "/mint", "/vault", "/settle", "/verify", "/judge"];
const b = await chromium.launch(); const dir = `/workspace/near_hackathon/qa_design2/shots/walk-${tag}`; mkdirSync(dir, { recursive: true });
for (const w of [1280, 390]) for (const p of pages) {
  const pg = await b.newPage({ viewport: { width: w, height: 900 } }); const errs = [];
  pg.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 160))); pg.on("pageerror", (e) => errs.push("PAGEERR " + e.message.slice(0, 160)));
  const r = await pg.goto(base + p, { waitUntil: "networkidle", timeout: 60000 }).catch(() => null); await pg.waitForTimeout(2500);
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await pg.screenshot({ path: `${dir}${p === "/" ? "/home" : p}-${w}.png`, fullPage: true });
  console.log(w, p, r?.status(), sw ? "HSCROLL" : "", errs.join(" | ")); await pg.close();
}
await b.close();
