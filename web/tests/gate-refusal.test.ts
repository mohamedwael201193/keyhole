import { describe, expect, it } from "vitest";
import { gateRefusalFrom, isGateRefusal } from "@/lib/opResult";

/** The worker's exact refusal message (tee/worker/src/native_send.rs: unresolved_error). */
const REFUSAL =
  "original send UNKNOWN_TRANSACTION; still within validity window, signer nonce not proven below the plan, or context incomplete; " +
  "tx_hash=A8PkhQPNP6pQw6CAq7rwbwB2gRRwxH49ANJLdfj7etwL; reference_block_height=224260488";
/** A send whose outcome is really unknown: no window claim, and no reference height. */
const UNKNOWN =
  "original send not yet FINAL; tx_hash=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; reference_block_height=unknown";

describe("isGateRefusal", () => {
  it("recognises the refusal-before-send by its message, not by the code alone", () => {
    expect(isGateRefusal("native_unknown", REFUSAL)).toBe(true);
    expect(isGateRefusal("native_unknown", UNKNOWN)).toBe(false);
    expect(isGateRefusal("native_unknown", null)).toBe(false);
    expect(isGateRefusal("native_unknown", "still within validity window")).toBe(false);
    expect(isGateRefusal("admission_unknown", REFUSAL)).toBe(false);
    expect(isGateRefusal(null, REFUSAL)).toBe(false);
  });
});

describe("gateRefusalFrom", () => {
  it("pulls the earlier operation's reference height and transaction hash out of the message", () => {
    expect(gateRefusalFrom(REFUSAL)).toEqual({
      refHeight: "224260488",
      txHash: "A8PkhQPNP6pQw6CAq7rwbwB2gRRwxH49ANJLdfj7etwL",
    });
    expect(gateRefusalFrom(UNKNOWN)).toEqual({ refHeight: null, txHash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(gateRefusalFrom(null)).toEqual({ refHeight: null, txHash: null });
  });
});
