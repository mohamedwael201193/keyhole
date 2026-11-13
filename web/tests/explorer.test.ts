import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explorerChain, explorerHost, explorerLabel, explorerName, explorerUrl, nearAccount, nearTx } from "@/lib/explorer";
import { explorerFor } from "@/components/activity/orders";
import { acct, tx } from "@/lib/config";
import { SETTLEMENTS } from "@/lib/settlements";
import { translate } from "@/lib/i18n";
import { explorerLabelKey } from "@/lib/atlasLabels";

const H64 = "0x" + "ab".repeat(32);
const ADDR = "0x" + "cd".repeat(20);
const SIG = "2GxLCAXcEjTQ6NraySheBYFuN7XGAZym96Dqtcdypy8LNrH1UEAfg2566gaGQey4q3YyjMKuhE4cN7RdTMQq94Xv";
const SOL_ACCT = "6pvcZZ2xMUhDpQmySGaVR2Cm9e3Aixx5QUQUPS7RAcha";
const NEAR_TX = "G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD";

describe("explorer helper: one host per chain", () => {
  it("NEAR opens NearBlocks (txns and address)", () => {
    expect(explorerUrl("near", "tx", NEAR_TX)).toBe(`https://nearblocks.io/txns/${NEAR_TX}`);
    expect(explorerUrl("near", "account", "keyhole-devmo.near")).toBe("https://nearblocks.io/address/keyhole-devmo.near");
  });
  it("Base opens BaseScan (tx and address)", () => {
    expect(explorerUrl("base", "tx", H64)).toBe(`https://basescan.org/tx/${H64}`);
    expect(explorerUrl("base", "account", ADDR)).toBe(`https://basescan.org/address/${ADDR}`);
  });
  it("Solana opens Solscan (tx and account)", () => {
    expect(explorerUrl("sol", "tx", SIG)).toBe(`https://solscan.io/tx/${SIG}`);
    expect(explorerUrl("sol", "account", SOL_ACCT)).toBe(`https://solscan.io/account/${SOL_ACCT}`);
  });
  it("Arbitrum opens Arbiscan", () => {
    expect(explorerUrl("arb", "tx", H64)).toBe(`https://arbiscan.io/tx/${H64}`);
  });
  it("names the host and the explorer, never another chain's", () => {
    expect([explorerHost("near"), explorerHost("base"), explorerHost("sol")]).toEqual(["nearblocks.io", "basescan.org", "solscan.io"]);
    expect([explorerName("near"), explorerName("base"), explorerName("sol")]).toEqual(["NearBlocks", "BaseScan", "Solscan"]);
    expect(explorerLabel("base")).toBe("Open on BaseScan");
    expect(explorerLabel("sol")).not.toMatch(/NearBlocks/);
    expect(explorerLabel("base")).not.toMatch(/NearBlocks/);
  });
  it("an id of the wrong shape gives no link instead of a guessed one", () => {
    expect(explorerUrl("base", "tx", SIG)).toBeNull();
    expect(explorerUrl("sol", "tx", H64)).toBeNull();
    expect(explorerUrl("base", "tx", "")).toBeNull();
    expect(explorerUrl("near", "tx", "../../evil")).toBeNull();
  });
  it("maps the chain words the product uses", () => {
    expect(explorerChain("sol")).toBe("sol");
    expect(explorerChain("solana")).toBe("sol");
    expect(explorerChain("eth:base")).toBe("base");
    expect(explorerChain("near")).toBe("near");
    expect(explorerChain("doge")).toBeNull();
    expect(explorerChain(undefined)).toBeNull();
  });
  it("the older tx and acct helpers and the activity list use the same hosts", () => {
    expect(tx(NEAR_TX)).toBe(nearTx(NEAR_TX));
    expect(acct("a.near")).toBe(nearAccount("a.near"));
    expect(explorerFor("base", H64)).toBe(`https://basescan.org/tx/${H64}`);
    expect(explorerFor("sol", SIG)).toBe(`https://solscan.io/tx/${SIG}`);
    expect(explorerFor("near", NEAR_TX)).toBe(`https://nearblocks.io/txns/${NEAR_TX}`);
    expect(explorerFor("doge", NEAR_TX)).toBeNull();
  });
  it("the recorded settlements link the explorer of their own chain", () => {
    for (const s of SETTLEMENTS) {
      if (!s.depositTxUrl) continue;
      const host = new URL(s.depositTxUrl).host;
      const chain = s.depositTx.startsWith("0x") ? "base" : s.depositTx.length > 60 ? "sol" : "near";
      expect(host).toBe(explorerHost(chain));
    }
  });
  it("Atlas labels name the host they open", () => {
    expect(translate(explorerLabelKey("base"))).toBe(explorerLabel("base"));
    expect(translate(explorerLabelKey("sol"))).toBe(explorerLabel("sol"));
    expect(translate(explorerLabelKey("near"))).toBe(explorerLabel("near"));
  });
  it("no component or page builds an explorer URL by hand", () => {
    const files = ["../components/judge/AttackBoard.tsx", "../components/landing/LiveStats.tsx", "../lib/liveChecks.ts", "../components/activity/orders.ts"];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src, f).not.toMatch(/https:\/\/(nearblocks\.io|basescan\.org|solscan\.io)\//);
    }
  });
});
