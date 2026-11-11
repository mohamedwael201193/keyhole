import { exactExitFields } from "./exactExit";
import { ASSETS, type AssetKey } from "./assets";
import { validAccountId } from "./keysApi";

/**
 * Request params for the worker, matching the CLI in cli/src/cli.ts.
 *
 * Swap and withdraw send NEP-141 asset ids (`nep141:…`). `usd_of` prices a token
 * only when it equals the USDC asset id or is an origin asset id, the canonical USDC self-exit uses the typed three-hop flow.
 *
 * Fund uses the symbol. `op_account` forwards `token` to the deposit API,
 * whose default is the symbol `"USDC"`.
 */
export function swapParams(from: AssetKey, to: AssetKey, amountIn: string, minAmountOut?: string) {
  return swapParamsById(ASSETS[from].id, ASSETS[to].id, amountIn, minAmountOut);
}

/** The swap for any two 1Click asset ids (the swap screen offers the whole token list). Amounts are base units. */
export function swapParamsById(fromId: string, toId: string, amountIn: string, minAmountOut?: string) {
  return {
    token_in: fromId,
    token_out: toId,
    amount_in: amountIn,
    // Only a positive integer is a floor. Zero would be refused by the enclave, so it is left out (the enclave then derives one).
    ...(minAmountOut && /^[1-9]\d*$/.test(minAmountOut) ? { min_amount_out: minAmountOut } : {}),
  };
}

/** Payout is fixed to the signed-in holder on NEAR; the worker independently verifies ownership. */
export function withdrawParams(accountId: string, asset: AssetKey, amount: string) {
  if (!validAccountId(accountId)) throw new Error("A valid signed-in NEAR account is required.");
  return { chain: "near" as const, to: accountId, token: ASSETS[asset].id, amount, ...(asset === "usdc" ? exactExitFields(amount) : {}) };
}

export function fundParams(asset: AssetKey, amount: string) {
  return { chain: "near" as const, token: ASSETS[asset].symbol, amount };
}
