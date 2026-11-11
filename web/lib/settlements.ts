// Real 1Click settlements on mainnet (2026-11-01 from keyhole-devmo.near; 2026-11-02 from a MetaMask wallet on Base). Status is read live.
export type Settlement = { label: string; depositAddress: string; depositTx: string; quote: string; depositTxUrl?: string; destTx?: { hash: string; url: string }; note?: string; recorded?: { status: string; note: string } };
export const SETTLEMENTS: Settlement[] = [
  { label: "0.03 wNEAR → USDC on NEAR", depositAddress: "8ce897e4047c1aa01f9c7c3e92b6392e424fa9e9564153a5c1f0ac563706cc45", depositTx: "BGyVQcr6pb1WpAFQJJCRUUoa5YgbdcgQkpC11KvyKgRd", quote: "0.131325 USDC quoted" },
  { label: "Under-deposit: 0.02 of a 0.05 USDC → wNEAR quote", depositAddress: "15a7f92d61890a802f33d08c631c4f4b7a5c185f336134cb3ae4a70984686794", depositTx: "J2UwPe1XzzugFT9UKnvEEacqFZCXDh6in4ZW2vb3Pgko", quote: "0.05 USDC quoted, 0.02 USDC sent", note: "Less than the quote arrived, so 1Click refunded the 0.02 USDC at the quote deadline. Status is read live from 1Click." },
  { label: "0.6 USDC on Base → SOL on Solana (MetaMask)", depositAddress: "0xF60390Eb2309c39A5Dc39a619352fCffe83105d6", depositTx: "0x0e46c0f0b49be71f36d4437e71fa9e1d689d4f91fc1e948872320d50126661f3", depositTxUrl: "https://basescan.org/tx/0x0e46c0f0b49be71f36d4437e71fa9e1d689d4f91fc1e948872320d50126661f3", destTx: { hash: "JYbHtieCb7QxwMkikJaoqSArVNgK9mYgEpWQj9rEEF8TQLeBV75M657XQ81HALejo3kMrX7yaNApvCJQUjqGg8X", url: "https://solscan.io/tx/JYbHtieCb7QxwMkikJaoqSArVNgK9mYgEpWQj9rEEF8TQLeBV75M657XQ81HALejo3kMrX7yaNApvCJQUjqGg8X" }, quote: "0.006266471 SOL quoted, 1% slippage", note: "Sent from a MetaMask EVM account on Base to a fresh Solana address; 0.006268509 SOL arrived (2026-11-02 13:41 UTC+2)." },
  { label: "0.004 SOL on Solana → USDC on NEAR (MetaMask)", depositAddress: "6pvcZZ2xMUhDpQmySGaVR2Cm9e3Aixx5QUQUPS7RAcha", depositTx: "2GxLCAXcEjTQ6NraySheBYFuN7XGAZym96Dqtcdypy8LNrH1UEAfg2566gaGQey4q3YyjMKuhE4cN7RdTMQq94Xv", depositTxUrl: "https://solscan.io/tx/2GxLCAXcEjTQ6NraySheBYFuN7XGAZym96Dqtcdypy8LNrH1UEAfg2566gaGQey4q3YyjMKuhE4cN7RdTMQq94Xv", quote: "0.36747 USDC quoted, 1% slippage", note: "0.367068 USDC arrived at keyhole-devmo.near on 2026-11-02 20:20:50 (UTC+2), inside the 1% slippage. Status is read live from 1Click." },
  { label: "Refund path: 0.001 SOL on Solana → USDC on NEAR, refunded for NO_LIQUIDITY", depositAddress: "5sESFfrM4Tk6L5euDCTjjMxVAs5xmbZpj4i3V29s3KJ", depositTx: "4ws4iem4khPUaQBBVCN9hAy1xE5fpb6dX2oVvgQZvBUvJGbZXDrSop76Cm5esge2xVB7W6h3BRPhAfpN6ioNEK8P", depositTxUrl: "https://solscan.io/tx/4ws4iem4khPUaQBBVCN9hAy1xE5fpb6dX2oVvgQZvBUvJGbZXDrSop76Cm5esge2xVB7W6h3BRPhAfpN6ioNEK8P", quote: "0.001 SOL sent; 0.00089235 SOL returned", note: "1Click found no liquidity and returned the deposit on Solana in tx 5qumXJw4… on 2026-11-02 19:44:52 (UTC+2). The 0.00010765 SOL difference went to network fees for handling and refunding the deposit. Status is read live from 1Click." },
];
/** A recorded example, clearly labelled, so the FAILED path is visible without breaking anything. */
export const RECORDED_FAILED = { status: "FAILED", label: "Recorded example (not a live order)", note: "Shape of a FAILED order as returned by /v0/status. KEYHOLE shows the refund address and asks the user to check the refund before retrying." };

/**
 * Public orders shared by the home strip and Activity → Public.
 * One sealed vault swap (VAULT_TRADE) plus each listed 1Click settlement.
 * RECORDED_FAILED is a status shape, not an order, and is not included.
 */
export function publicOrderCensus() {
  const vaultSwaps = 1;
  const oneClick = SETTLEMENTS.length;
  return {
    total: vaultSwaps + oneClick,
    vaultSwaps,
    oneClick,
    label: "Public orders",
    detail: `${vaultSwaps} sealed vault swap and ${oneClick} 1Click orders`,
  };
}

/** One vault trade: the key's own sealed account swapped inside the enclave, settled through NEAR Intents (mainnet E2E step 08, build f13efe92). */
export const VAULT_TRADE = { callId: "09d58c09-c1e9-48b6-bebb-485f5ae79539", account: "keyhole-devmo.near", token: "0", amountIn: "0.005 USDC", amountOut: "0.001077 wNEAR", intentHash: "Xr4TM3tEwfpwF9Hg2BcGJTH3uzZ7LroqBk9wgUnN1so", build: "f13efe92", file: "docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json" };
