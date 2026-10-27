/** Public, non-secret configuration. Every value is real mainnet state. */
export const KEYS_CONTRACT = "keyhole-devmo.near";
export const NEP413_RECIPIENT = "keyhole";
export const RPC_URL = "https://rpc.mainnet.near.org";
export const OUTLAYER_API = "https://api.outlayer.ai";
export const OUTLAYER_OWNER = "keyhole-devmo.near";
export const OUTLAYER_PROJECT = process.env.NEXT_PUBLIC_OUTLAYER_PROJECT || "keyhole";
/** sha256 of the worker wasm published on-chain via FastFS (add_version tx below). */
export const WORKER_WASM_SHA256 = (process.env.NEXT_PUBLIC_WORKER_WASM_SHA256 ||
  "f13efe92613284bac3a4d09b1e8eca45d0f36a84ec238be125975a8eca28119c,3ea56ee6078f019ba4c2880d0603dc01f30dad7a3716db158515a5accda8544c,fc4ae4ac70d7aafed5ea9d8b864b4bbbb912e226feeb6cc415ea515782b12fab").split(",").map((s) => s.trim().toLowerCase());
export const WORKER_PUBLISH_TX = "A6E9JMRn4di5nYVgRRj4QsmWcNouuCQkDLEN2XLM6Hwn";
export const TEE_MINTER = "4a1bb5b836ee697c9012fa79246f74d936fbd000481f9d9086fee45057948a8d";
export const NEARBLOCKS = "https://nearblocks.io";
export const tx = (h: string) => `${NEARBLOCKS}/txns/${h}`;
export const acct = (a: string) => `${NEARBLOCKS}/address/${a}`;
export const attestation = (callId: string) => `${OUTLAYER_API}/attestations/by-call/${callId}`;
