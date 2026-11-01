// Real 1Click settlements executed from keyhole-devmo.near on mainnet (2026-11-01). Status is read live.
export type Settlement = { label: string; depositAddress: string; depositTx: string; quote: string; recorded?: { status: string; note: string } };
export const SETTLEMENTS: Settlement[] = [
  { label: "0.03 wNEAR → USDC on NEAR", depositAddress: "8ce897e4047c1aa01f9c7c3e92b6392e424fa9e9564153a5c1f0ac563706cc45", depositTx: "BGyVQcr6pb1WpAFQJJCRUUoa5YgbdcgQkpC11KvyKgRd", quote: "0.131325 USDC quoted" },
  { label: "Under-deposit: 0.02 of a 0.05 USDC → wNEAR quote", depositAddress: "15a7f92d61890a802f33d08c631c4f4b7a5c185f336134cb3ae4a70984686794", depositTx: "J2UwPe1XzzugFT9UKnvEEacqFZCXDh6in4ZW2vb3Pgko", quote: "refund due at the deadline, 2026-11-04 07:30 (UTC+2)" },
];
/** A recorded example, clearly labelled, so the FAILED path is visible without breaking anything. */
export const RECORDED_FAILED = { status: "FAILED", label: "Recorded example (not a live order)", note: "Shape of a FAILED order as returned by /v0/status. KEYHOLE shows the refund address and asks the user to check the refund before retrying." };
