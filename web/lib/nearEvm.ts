import { defineChain } from "viem";

/** NEAR mainnet as an EVM chain. Chain id 397. */
export const nearMainnetEvm = defineChain({
  id: 397,
  name: "NEAR Protocol",
  nativeCurrency: { name: "NEAR", symbol: "NEAR", decimals: 18 },
  rpcUrls: { default: { http: ["https://eth-rpc.mainnet.near.org"] } },
  blockExplorers: { default: { name: "NEAR Explorer", url: "https://eth-explorer.near.org" } },
});
