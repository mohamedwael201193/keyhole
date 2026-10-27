/** Real mainnet evidence. Every entry is a NEAR transaction hash or an OutLayer call id that resolves publicly. */
export const TXS = [
  { label: "Deploy + init keys contract", hash: "HEgxese5vwUeAz2ctbwpdNDjfyhLib7xWXpTJLhwhRD7" },
  { label: "Mint key #0 (tier 1)", hash: "UYHismxe3a2Xb5YvbVHuGhsHWf7ERrx5oCrxREePBFR" },
  { label: "beat → nft_metadata_update event", hash: "2ShJpaoicEm49L9rcsJjXoubuzoF3SvbQFZASUQBi5dq" },
  { label: "Worker wasm published (FastFS add_version)", hash: "A6E9JMRn4di5nYVgRRj4QsmWcNouuCQkDLEN2XLM6Hwn" },
  { label: "Fund TEE-held minter", hash: "CHGRDBofZSMkTTvKKA5DsqHURyTVAwFDzfXZ8w44ko89" },
  { label: "set_minter → TEE-held account", hash: "HZ3Srg1K2S2srBkBFTF6gGnTMdXYRdAjcgjooTwhv8eE" },
  { label: "Mint by the TEE to a fresh account", hash: "FaYzSUYTzoG3udAE3d31sUwWFeskndkhrZ8iehk1NxJ4" },
] as const;

export const CALLS = [
  { label: "status (signed read)", id: "e099f957-e3c6-4035-999a-907d9782997e", outcome: "ok" },
  { label: "confidential quote 0.05 USDC → wNEAR", id: "b8a83c55-61bb-448f-8196-08dc23a574df", outcome: "policy passed ($0.0499)" },
  { label: "same signature replayed", id: "cb3e197b-61d0-44cb-8fdf-99114b409b25", outcome: "refused: replay" },
  { label: "2 USDC over the $1 cap", id: "b8daeed3-b745-432c-98f8-0af674f0da51", outcome: "refused: over_cap_per_tx" },
  { label: "quote without a key", id: "a8097323-9fdd-457e-b417-721599793c08", outcome: "refused: no_key" },
  { label: "mint inside the TEE", id: "806a1150-8ebb-42b7-b848-fa1dc69299a4", outcome: "minted k857b6b68facc0f94" },
  { label: "second mint, same account", id: "b14ffaea-21fe-4fa2-88f8-15a411f8e08f", outcome: "refused: already_holder" },
  { label: "site gateway · quote signed with the browser's NEP-413 code", id: "57d03a3b-def4-46dc-a66f-6cfd36570572", outcome: "policy passed ($0.05)" },
  { label: "site gateway · 2 USDC over the cap", id: "a28106f0-8eff-49e6-8998-57d99d2e9298", outcome: "refused: over_cap_per_tx" },
  { label: "site gateway · replayed signature", id: "6eccc374-ed17-4764-810b-f3f56a1ad6bd", outcome: "refused: replay" },
  { label: "site gateway · open confidential account", id: "e977cb88-0490-47f8-abfd-eb409eb572b4", outcome: "confidential id issued" },
  { label: "site gateway · read confidential balance", id: "22cb472d-a759-4284-a3fd-651b059dc576", outcome: "ok" },
] as const;

/** Per-chain trail on the atlas. `real` = a KEYHOLE artefact exists; otherwise clearly labeled. */
export const ATLAS: { chain: string; name: string; kind: "tx" | "call" | "none"; ref?: string; note: string }[] = [
  { chain: "near", name: "NEAR", kind: "tx", ref: "FaYzSUYTzoG3udAE3d31sUwWFeskndkhrZ8iehk1NxJ4", note: "Key minted by the TEE-held minter" },
  { chain: "usdc", name: "USDC", kind: "call", ref: "b8a83c55-61bb-448f-8196-08dc23a574df", note: "Attested confidential quote, dry (no funds moved)" },
  { chain: "eth", name: "ETH", kind: "none", note: "" },
  { chain: "base", name: "Base", kind: "none", note: "" },
  { chain: "arb", name: "ARB", kind: "none", note: "" },
  { chain: "sol", name: "SOL", kind: "none", note: "" },
  { chain: "btc", name: "BTC", kind: "none", note: "" },
  { chain: "zec", name: "ZEC", kind: "none", note: "" },
];
