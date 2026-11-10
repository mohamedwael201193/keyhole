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
  type LoanState,
  type PledgeConfig,
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
  domain: "KEYHOLE_SEALED_LOAN_V2_CREDIT",
  network: "mainnet",
  contract: "keyhole-devmo.near",
  token_id: "0",
  loan_nonce: "1",
  borrower: "alice.near",
  owner_epoch: "0",
  terms,
  asset: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  wallet_pubkey: "ed25519:ab",
  policy_version: "1",
  policy_hash: "",
  observed_at_ns: "1",
  expires_at_ns: "2",
  floor_met: true,
  frozen: true,
  pending_value_ops: "0",
};

describe("pledgeClient method surface (oracle-free contract candidate)", () => {
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
      if (method === "get_loan") return { token_id: "0", state: "Active" };
      if (method === "get_collateral_binding") return { ready: true, wallet_pubkey: "ed25519:ab" };
      return null;
    });
    const c = createPledgeClient({ live: true, view: view as never });
    expect(c.canTransact()).toBe(true);
    expect((await c.getPledgeConfig())?.lending_enabled).toBe(true);
    expect((await c.getLoan("0"))?.state).toBe("Active");
    expect((await c.getCollateralBinding("0"))?.ready).toBe(true);
    expect(view).toHaveBeenCalledTimes(3);
  });
});


describe("oracle-free credit lifecycle ABI", () => {
  it("uses current contract phases and optional pending native claim without an outcome-signer role", async () => {
    const phases: LoanState[] = ["Freezing", "Offered", "Active", "UnlockPending"];
    const config: PledgeConfig = {
      recovery_account: "recovery.near", recovery_unlock_ns: "1796169600000000000",
      attestor_public_key: "floor-key-only", custody_contract: "custody.near", network: "sandbox",
      lending_enabled: false, next_loan_nonce: "1", next_payout_nonce: "2",
      treasury_available: "0", user_liabilities: "100", treasury_pending: { nonce: "2", amount: "100" },
    };
    const client=createPledgeClient({live:true,view:(async (method:string) => method === "get_pledge_config" ? config : null) as never});
    expect((await client.getPledgeConfig())?.treasury_pending).toEqual({nonce:"2",amount:"100"});
    expect(phases).toEqual(["Freezing", "Offered", "Active", "UnlockPending"]);
    expect(PLEDGE_CHANGE_METHODS).not.toContain("reconcile_terminal_outcome");
    expect(PLEDGE_VIEW_METHODS).not.toContain("terminal_attestor_public_key");
  });
});
