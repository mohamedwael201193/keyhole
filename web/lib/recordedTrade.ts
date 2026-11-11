/**
 * The trial does not trade inside the enclave. This is a recorded mainnet vault swap,
 * the same call as docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json.
 */
export const RECORDED_MAINNET_TRADE = {
  label: "recorded on mainnet" as const,
  callId: "09d58c09-c1e9-48b6-bebb-485f5ae79539",
  summary: "0.005 USDC swapped to wNEAR inside a confidential account. The enclave settled it on NEAR mainnet.",
  evidence: "docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json",
};
