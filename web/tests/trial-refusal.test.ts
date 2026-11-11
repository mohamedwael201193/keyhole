import { describe, expect, it } from "vitest";
import { classifyRefusal, transferLanded } from "@/lib/trialRefusal";
import { TRIAL_CONTRACT } from "@/lib/trialPublic";

const SIGNER = "khab12cd34ef56.testnet";
const TOKEN = "kab12cd34ef567890";
const RECEIVER = "kh000000000000.testnet";

function args(token = TOKEN, receiver = RECEIVER): string {
  return Buffer.from(JSON.stringify({ receiver_id: receiver, token_id: token, memo: "practice handover" })).toString("base64");
}
function panic(message: string) {
  return { Failure: { ActionError: { kind: { FunctionCallError: { ExecutionError: `Smart contract panicked: ${message}` } } } } };
}
function tx(message: string, patch: Record<string, unknown> = {}) {
  const base = {
    final_execution_status: "FINAL",
    status: panic(message),
    transaction: {
      signer_id: SIGNER,
      receiver_id: TRIAL_CONTRACT,
      actions: [{ FunctionCall: { method_name: "nft_transfer", args: args() } }],
    },
    receipts_outcome: [{ outcome: { executor_id: TRIAL_CONTRACT, status: panic(message) } }],
  };
  return { ...base, ...patch, transaction: { ...base.transaction, ...(patch.transaction as object | undefined) } };
}

const expectRefusal = { signer: SIGNER, tokenId: TOKEN, receiverId: RECEIVER };

describe("old holder refusal", () => {
  it("accepts only a FINAL Sender not approved receipt on the pinned contract", () => {
    expect(classifyRefusal(tx("Sender not approved"), expectRefusal)).toBe("refused");
  });

  it("an unrelated panic is unknown, not a refusal", () => {
    expect(classifyRefusal(tx("one key per account: receiver already holds a KEYHOLE key"), expectRefusal)).toBe("unknown");
  });

  it("rejects a receipt that is not final, not the signer, or not this token", () => {
    expect(classifyRefusal(tx("Sender not approved", { final_execution_status: "EXECUTED" }), expectRefusal)).toBe("unknown");
    expect(classifyRefusal(tx("Sender not approved", { transaction: { signer_id: "other.testnet" } }), expectRefusal)).toBe("unknown");
    expect(classifyRefusal(tx("Sender not approved", { transaction: { receiver_id: "keyhole-devmo.near" } }), expectRefusal)).toBe("unknown");
    expect(classifyRefusal(tx("Sender not approved", { transaction: { actions: [{ FunctionCall: { method_name: "nft_transfer", args: args("kother", RECEIVER) } }] } }), expectRefusal)).toBe("unknown");
  });

  it("a successful transfer is not a refusal, and transferLanded requires the same receipt", () => {
    const ok = tx("Sender not approved", { status: { SuccessValue: "" }, receipts_outcome: [] });
    expect(classifyRefusal(ok, expectRefusal)).toBe("unknown");
    expect(transferLanded(ok, { ...expectRefusal, receiverId: "khcd56ab78ef90.testnet" })).toBe(false);
    const landed = {
      final_execution_status: "FINAL",
      status: { SuccessValue: "" },
      transaction: {
        signer_id: SIGNER,
        receiver_id: TRIAL_CONTRACT,
        actions: [{ FunctionCall: { method_name: "nft_transfer", args: args(TOKEN, "khcd56ab78ef90.testnet") } }],
      },
    };
    expect(transferLanded(landed, { signer: SIGNER, tokenId: TOKEN, receiverId: "khcd56ab78ef90.testnet" })).toBe(true);
  });
});
