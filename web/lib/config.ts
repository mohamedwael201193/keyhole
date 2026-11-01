/** Public, non-secret configuration. Every value is real mainnet state. */
export const KEYS_CONTRACT = "keyhole-devmo.near";
export const NEP413_RECIPIENT = "keyhole";
export const RPC_URL = "https://rpc.mainnet.near.org";
export const OUTLAYER_API = "https://api.outlayer.ai";
export const OUTLAYER_OWNER = "keyhole-devmo.near";
export const OUTLAYER_PROJECT = process.env.NEXT_PUBLIC_OUTLAYER_PROJECT || "keyhole";
/** Current published wasm first, then superseded builds. The home stat and vault pill use [0]. */
export const WORKER_WASM_SHA256 = (process.env.NEXT_PUBLIC_WORKER_WASM_SHA256 ||
  "38bd67b930ea829cd0fdfad1c09d9d6b93e12f422c8c58a5c84b6899be9f5c78,b3fa1a394bceca3dc34efd044e430498d7d3bb9c5032290eaab87021fda2388a,f13efe92613284bac3a4d09b1e8eca45d0f36a84ec238be125975a8eca28119c,3ea56ee6078f019ba4c2880d0603dc01f30dad7a3716db158515a5accda8544c,fc4ae4ac70d7aafed5ea9d8b864b4bbbb912e226feeb6cc415ea515782b12fab").split(",").map((s) => s.trim().toLowerCase());
export const WORKER_PUBLISH_TX = "9pk1mDC1dxzTXE7H7mHLXVVckHMEmRA4VnfxfxAzdb2z";
export const TEE_MINTER = "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443";
export const NEARBLOCKS = "https://nearblocks.io";
export const tx = (h: string) => `${NEARBLOCKS}/txns/${h}`;
export const acct = (a: string) => `${NEARBLOCKS}/address/${a}`;
/** Public transaction page. The path is /transactions/<id>; an intent hash uses that same path. */
export const INTENTS_EXPLORER = "https://explorer.near-intents.org";
export const intentTx = (hash: string) => `${INTENTS_EXPLORER}/transactions/${hash}`;
export const attestation = (callId: string) => `${OUTLAYER_API}/attestations/by-call/${callId}`;
