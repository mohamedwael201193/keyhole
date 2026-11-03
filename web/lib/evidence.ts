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

/** Live info call on the published worker f7217ae2. Default on /verify. */
export const PUBLISHED_INFO_CALL = "54207d9e-b4f0-438b-9a74-cdba33de80d9";

export const CALLS = [
  { label: "info · published build f7217ae2", id: PUBLISHED_INFO_CALL, outcome: "ok · attestation 1252377" },
  { label: "info · previous build 452df1fd", id: "7882f97a-06e5-46d3-9e58-5fe6428fb187", outcome: "ok · attestation 1246133" },
  { label: "attack · injected agent sends a payout to attacker.near", id: "c1312e2d-8c20-4b3e-ad5b-22dd3102826d", outcome: "refused · bad_params" },
  { label: "attack · drain $2.00 past the holder cap", id: "afaaf3e1-32ff-42d8-88da-412a0bb61e11", outcome: "refused · over_cap_per_tx" },
  { label: "attack · raise the caps (waits 24 h)", id: "06cf2630-aed4-410a-9e28-f0799efddeda", outcome: "ok · pending" },
  { label: "attack · replay a signed request", id: "d8f5f0ee-3c0b-44bc-afed-bc24ad190ed0", outcome: "refused · replay" },
  { label: "attack · edit the recipient, keep the signature", id: "16b09581-9010-4600-b5c5-58af0216cdc8", outcome: "refused · bad_signature" },
  { label: "attack · previous holder reads the vault", id: "711795b9-3e77-4a59-98ee-d798cb63ccc2", outcome: "refused · not_owner" },
  { label: "mid-payout · withdraw paid to the holder who signed it, key moved mid-flight", id: "129161f9-2534-4a3f-9544-44f8da9dd7c2", outcome: "ok · 0.003 USDC to B" },
  { label: "mid-payout · old holder after the transfer", id: "e72dc176-e6fc-4d89-b348-911f5318b81b", outcome: "refused · not_owner" },
  { label: "mid-payout · new holder sees the rest (0.002 USDC)", id: "f36d9b54-417a-4b33-9598-c396ae852d4d", outcome: "ok" },
  { label: "withdraw within 10 min of a transfer", id: "369f522d-4bef-4b17-9071-1de01616eef6", outcome: "refused · cooldown" },
  { label: "pnl · signed by the minter, bound to key and request", id: "dda27438-67e6-4c8a-8f32-888d3ff17760", outcome: "ok" },
  { label: "status · locked_until_ms, holder limits", id: "3e53ce83-4c4c-4769-820d-ba8a446dd335", outcome: "ok" },
  { label: "quote · $0.0099 over a $0.0020 holder cap", id: "4eae763a-5732-4e6b-9907-2b8c6294f170", outcome: "refused · over_cap_per_tx" },
  { label: "info · previous build 6367401a", id: "f4768da8-2e87-4622-8654-d1e67f6cd1f0", outcome: "ok · attestation 1227292" },
  { label: "info · previous build 67c5cd77", id: "0f0bf448-1b66-4200-b6de-7cf095aead54", outcome: "ok · attestation 1225814" },
  { label: "info · previous build 38bd67b9", id: "763812bc-0012-4528-a45d-66a3ce17cae9", outcome: "ok · attestation 1223764" },
  { label: "info · previous build b3fa1a39", id: "9d19bceb-986b-4745-9bf9-91f7dcb62b6e", outcome: "ok · attestation 1189623" },
  { label: "earlier · status (signed read)", id: "e099f957-e3c6-4035-999a-907d9782997e", outcome: "ok" },
  { label: "earlier · confidential quote 0.05 USDC → wNEAR", id: "b8a83c55-61bb-448f-8196-08dc23a574df", outcome: "policy passed ($0.0499)" },
  { label: "earlier · same signature replayed", id: "cb3e197b-61d0-44cb-8fdf-99114b409b25", outcome: "refused: replay" },
  { label: "earlier · 2 USDC over the $1 cap", id: "b8daeed3-b745-432c-98f8-0af674f0da51", outcome: "refused: over_cap_per_tx" },
  { label: "earlier · quote without a key", id: "a8097323-9fdd-457e-b417-721599793c08", outcome: "refused: no_key" },
  { label: "earlier · mint inside the TEE", id: "806a1150-8ebb-42b7-b848-fa1dc69299a4", outcome: "minted k857b6b68facc0f94" },
  { label: "earlier · second mint, same account", id: "b14ffaea-21fe-4fa2-88f8-15a411f8e08f", outcome: "refused: already_holder" },
  { label: "earlier · site gateway · quote signed with the browser's NEP-413 code", id: "57d03a3b-def4-46dc-a66f-6cfd36570572", outcome: "policy passed ($0.05)" },
  { label: "earlier · site gateway · 2 USDC over the cap", id: "a28106f0-8eff-49e6-8998-57d99d2e9298", outcome: "refused: over_cap_per_tx" },
  { label: "earlier · site gateway · replayed signature", id: "6eccc374-ed17-4764-810b-f3f56a1ad6bd", outcome: "refused: replay" },
  { label: "earlier · site gateway · open confidential account", id: "e977cb88-0490-47f8-abfd-eb409eb572b4", outcome: "confidential id issued" },
  { label: "earlier · site gateway · read confidential balance", id: "22cb472d-a759-4284-a3fd-651b059dc576", outcome: "ok" },
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
