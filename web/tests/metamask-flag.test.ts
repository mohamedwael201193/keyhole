import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const doc = readFileSync(new URL("../../research/METAMASK_FLAG.md", import.meta.url), "utf8");
describe("MetaMask flag research", () => {
  it("names the scanner endpoint", () => expect(doc).toContain("dapp-scanning.api.cx.metamask.io"));
  it("has the false-positive report URL", () => expect(doc).toContain("https://github.com/MetaMask/eth-phishing-detect/issues/new?template=02-blocklist-removal.yaml"));
  it("records the control that a never-deployed vercel.app name is also blocked", () => expect(doc).toMatch(/never deployed\) \| BLOCK/));
  it("says nothing was submitted", () => expect(doc).toMatch(/Nothing was submitted/));
});
