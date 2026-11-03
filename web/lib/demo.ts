/**
 * Guest / demo vault: a read-only replay of a real mainnet session (docs/evidence/mainnet-e2e, 2026-10-27,
 * previous worker build f13efe92, holder keyhole-devmo.near). Every row links to its attested enclave call or tx.
 */
export const DEMO_META = { account: "keyhole-devmo.near", date: "2026-10-27", build: "f13efe92", source: "docs/evidence/mainnet-e2e" } as const;
export type DemoProof = { kind: "call" | "tx" | "intent"; ref: string };
export type DemoStep = { id: string; title: string; does: string; result: string; ok: boolean; proofs: DemoProof[]; rows?: [string, string][] };
export const DEMO_STEPS: DemoStep[] = [
  { id: "connect", title: "Connect", does: "The holder connects a NEAR wallet. Here the session is replayed as keyhole-devmo.near; nothing is signed.", result: "Holder keyhole-devmo.near", ok: true,
    proofs: [{ kind: "call", ref: "cefbc64e-6c08-4bfe-a165-1667d9f5f25b" }], rows: [["Enclave ops", "info, status, quote, mint, balance, swap, withdraw, history…"], ["Signed-message recipient", "keyhole"]] },
  { id: "mint", title: "Mint the key", does: "The TEE-held minter mints the NFT. The NFT is the viewing key to one sealed account.", result: "Key minted on mainnet", ok: true,
    proofs: [{ kind: "tx", ref: "FaYzSUYTzoG3udAE3d31sUwWFeskndkhrZ8iehk1NxJ4" }], rows: [["Minter", "015a0259…ac443 (key generated inside the TEE)"]] },
  { id: "limits", title: "Limits", does: "The enclave applies the key's tier caps to every value-moving call.", result: "Bronze: $1.00 per trade, $5.00 per day, 6 calls/min", ok: true,
    proofs: [{ kind: "call", ref: "cefbc64e-6c08-4bfe-a165-1667d9f5f25b" }] },
  { id: "fund", title: "Fund", does: "A 1Click quote returns a deposit address; funds land in the key's confidential account.", result: "Sealed balance: 0.02 USDC + 0.002163 wNEAR", ok: true,
    proofs: [{ kind: "call", ref: "a1bf58e8-d3ba-4a77-ae86-9e31fe5b8523" }, { kind: "call", ref: "9374b0ac-dcdf-4416-b162-2ebc8c13483d" }],
    rows: [["Deposit address", "55c0d718…2e9450c05"], ["Confidential id", "2c2c4942…78fd21ca"]] },
  { id: "trade", title: "Trade", does: "The holder swaps inside the enclave; it settles through NEAR Intents.", result: "0.005 USDC → 0.001077 wNEAR · success", ok: true,
    proofs: [{ kind: "call", ref: "09d58c09-c1e9-48b6-bebb-485f5ae79539" }, { kind: "intent", ref: "Xr4TM3tEwfpwF9Hg2BcGJTH3uzZ7LroqBk9wgUnN1so" }] },
  { id: "guard", title: "Guardrails", does: "Over-cap and replayed requests are refused inside the enclave, and the refusal is attested too.", result: "$2.00 trade refused (over_cap_per_tx) · replay refused", ok: false,
    proofs: [{ kind: "call", ref: "a02613a2-d503-45e2-83b8-ef71927c2533" }, { kind: "call", ref: "ac289f04-0df8-4161-9123-e872ab3b75ab" }] },
  { id: "withdraw", title: "Withdraw", does: "Withdrawals go only to the account that signed; the sealed account ends empty.", result: "wNEAR and USDC withdrawn · final balance empty", ok: true,
    proofs: [{ kind: "call", ref: "afc0f232-7d93-4a0e-8768-f62f245c537e" }, { kind: "call", ref: "3ef04098-f287-4527-a8f2-52511beaa9e3" }] },
];
