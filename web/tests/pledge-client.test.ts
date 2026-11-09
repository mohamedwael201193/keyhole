import { describe, expect, it, vi } from "vitest";
import {
  PLEDGE_CHANGE_METHODS,
  PLEDGE_CTA_DISABLED,
  PLEDGE_PREVIEW_LABEL,
  PLEDGE_VIEW_METHODS,
  buildCancelLoan,
  buildClaimDefault,
  buildFundLoan,
  buildOpenLoan,
  buildRegisterCollateral,
  buildRepayLoan,
  createPledgeClient,
  type LoanCertificate,
  type LoanTerms,
} from "@/lib/pledgeClient";

const terms: LoanTerms = {
  lender: "lender.near",
  principal: "10000000000000000000000",
  repayment: "10100000000000000000000",
  duration_sec: "259200",
  grace_sec: "3600",
  floor_raw: "500000",
  funding_deadline_ns: "1",
};

const cert: LoanCertificate = {
  domain: "keyhole.pledge",
  network: "mainnet",
  contract: "keyhole-devmo.near",
  token_id: "0",
  loan_nonce: "1",
  borrower: "alice.near",
  owner_epoch: "0",
  terms,
  asset: "usdc.near",
  wallet_pubkey: "ed25519:ab",
  policy_version: "1",
  policy_hash: "",
  observed_at_ns: "1",
  expires_at_ns: "2",
  floor_met: true,
  frozen: true,
  pending_value_ops: "0",
};

describe("pledgeClient method surface (PR #184 head 0c3c6196)", () => {
  it("exposes the sealed bilateral change methods by exact name", () => {
    expect([...PLEDGE_CHANGE_METHODS]).toEqual([
      "migrate_pledge",
      "set_lending_enabled",
      "register_collateral",
      "open_loan",
      "fund_loan",
      "repay_loan",
      "cancel_loan",
      "claim_default",
      "claim_payout",
      "fund_treasury",
      "recover_treasury",
    ]);
  });

  it("exposes the view methods get_pledge_config, get_loan, get_collateral_binding", () => {
    expect([...PLEDGE_VIEW_METHODS]).toEqual(["get_pledge_config", "get_loan", "get_collateral_binding"]);
  });

  it("builds open_loan / fund_loan / repay_loan / cancel_loan / claim_default / register_collateral payloads", () => {
    expect(buildOpenLoan({ token_id: "0", terms }).method).toBe("open_loan");
    expect(buildFundLoan({ token_id: "0", nonce: "1", certificate: cert, signature: "sig" }).method).toBe("fund_loan");
    expect(buildRepayLoan({ token_id: "0", nonce: "1" }, terms.repayment).deposit).toBe(terms.repayment);
    expect(buildCancelLoan({ token_id: "0", nonce: "1" }).method).toBe("cancel_loan");
    expect(buildClaimDefault({ token_id: "0", nonce: "1", receiver_id: "lender.near" }).method).toBe("claim_default");
    expect(buildRegisterCollateral({ token_id: "0", wallet_pubkey: "ed25519:ab", encrypted_data: "x" }).method).toBe(
      "register_collateral",
    );
  });
});

describe("feature flag OFF (production default)", () => {
  it("refuses live views and canTransact when live=false", async () => {
    const view = vi.fn();
    const c = createPledgeClient({ live: false, view });
    expect(c.canTransact()).toBe(false);
    expect(await c.getPledgeConfig()).toBeNull();
    expect(await c.getLoan("0")).toBeNull();
    expect(await c.getCollateralBinding("0")).toBeNull();
    expect(view).not.toHaveBeenCalled();
  });

  it("preview CTA copy never claims live", () => {
    expect(PLEDGE_CTA_DISABLED).toBe("Pledge launches after audit");
    expect(PLEDGE_PREVIEW_LABEL).toBe("Preview — in review · not live");
  });
});

describe("feature flag ON", () => {
  it("calls the typed view methods through the injected transport", async () => {
    const view = vi.fn(async (method: string) => {
      if (method === "get_pledge_config") return { lending_enabled: true, network: "mainnet" };
      if (method === "get_loan") return { token_id: "0", state: "Funded" };
      if (method === "get_collateral_binding") return { ready: true, wallet_pubkey: "ed25519:ab" };
      return null;
    });
    const c = createPledgeClient({ live: true, view: view as never });
    expect(c.canTransact()).toBe(true);
    expect((await c.getPledgeConfig())?.lending_enabled).toBe(true);
    expect((await c.getLoan("0"))?.state).toBe("Funded");
    expect((await c.getCollateralBinding("0"))?.ready).toBe(true);
    expect(view).toHaveBeenCalledTimes(3);
  });
});
