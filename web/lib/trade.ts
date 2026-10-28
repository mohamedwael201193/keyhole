import { ASSETS, type AssetKey } from "./assets";

/**
 * Request params for the worker, matching the CLI in cli/src/cli.ts.
 *
 * Swap and withdraw send NEP-141 asset ids (`nep141:…`). `usd_of` prices a token
 * only when it equals the USDC asset id or is an origin asset id, then
 * `/wallet/v1/confidential/withdraw` receives that same string.
 *
 * Fund uses the symbol. `op_account` forwards `token` to the deposit API,
 * whose default is the symbol `"USDC"`.
 */
export function swapParams(from: AssetKey, to: AssetKey, amountIn: string, minAmountOut?: string) {
  return {
    token_in: ASSETS[from].id,
    token_out: ASSETS[to].id,
    amount_in: amountIn,
    ...(minAmountOut ? { min_amount_out: minAmountOut } : {}),
  };
}

export function withdrawParams(accountId: string, asset: AssetKey, amount: string) {
  return { chain: "near" as const, to: accountId, token: ASSETS[asset].id, amount };
}

export function fundParams(asset: AssetKey, amount: string) {
  return { chain: "near" as const, token: ASSETS[asset].symbol, amount };
}
