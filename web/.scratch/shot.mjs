import { chromium } from "playwright";
const base = process.argv[2], tag = process.argv[3];
const b = await chromium.launch();
for (const w of [1280, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 900 } });
  await p.goto(base + "/settle", { waitUntil: "networkidle" });
  await p.getByTestId("agent-policy").waitFor({ timeout: 30000 });
  await p.getByTestId("agent-dry-over").click(); await p.getByTestId("agent-dry-out").waitFor({ timeout: 30000 });
  console.log(w, await p.getByTestId("agent-policy").getAttribute("data-match"), await p.getByTestId("agent-dry-out").innerText());
  await p.getByTestId("agent").screenshot({ path: `/workspace/near_hackathon/qa_design2/shots/${tag}-agent-${w}.png` });
}
await b.close();
