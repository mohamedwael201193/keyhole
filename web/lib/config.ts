/** Public configuration. Production remains pinned to mainnet; sandbox requires an explicit isolated fixture build. */
import { IDENTITY } from "./identity.gen";
export const PLEDGE_SANDBOX=process.env.NEXT_PUBLIC_PLEDGE_SANDBOX==="1";
const sandboxRpc=process.env.NEXT_PUBLIC_PLEDGE_SANDBOX_RPC??"";
if(PLEDGE_SANDBOX){const u=new URL(sandboxRpc);if(u.protocol!=="http:"||u.hostname!=="127.0.0.1"||!u.port||Number(u.port)<1024||Number(u.port)>65535||u.pathname!=="/"||u.search||u.hash||u.username||u.password)throw Error("Invalid isolated sandbox RPC");}
export const KEYS_CONTRACT = PLEDGE_SANDBOX?"ui-keys.test.near":"keyhole-devmo.near";
/** Keys the landing collection shows. The page reads exactly this many keys and their tiers. */
export const LANDING_KEYS = 4;
export const NEP413_RECIPIENT = "keyhole";
export const RPC_URL = PLEDGE_SANDBOX?sandboxRpc:"https://rpc.mainnet.fastnear.com";
export const OUTLAYER_API = "https://api.outlayer.ai";
export const OUTLAYER_OWNER = "keyhole-devmo.near";
export const OUTLAYER_PROJECT = process.env.NEXT_PUBLIC_OUTLAYER_PROJECT || "keyhole";
/** Current published wasm first, then superseded builds. The home stat and vault pill use [0]. */
/** Fixed in code, not read from env, so no deploy setting can put a superseded build first. */
export const WORKER_WASM_SHA256: readonly string[] = [...new Set([
  IDENTITY.worker.wasm_sha256,
  IDENTITY.worker.previous_wasm_sha256,
  ...IDENTITY.worker.historical_wasm_sha256,
])];
export const WORKER_PUBLISH_TX: string = IDENTITY.worker.add_version_tx;
export const CONTRACT_CODE_HASH: string = IDENTITY.contract.code_hash;
export const CONTRACT_WASM_SHA256: string = IDENTITY.contract.wasm_sha256;
export const TEE_MINTER = "015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443";
export const NEARBLOCKS = "https://nearblocks.io";
export const tx = (h: string) => `${NEARBLOCKS}/txns/${h}`;
export const acct = (a: string) => `${NEARBLOCKS}/address/${a}`;
/** Public transaction page. The path is /transactions/<id>; an intent hash uses that same path. */
export const INTENTS_EXPLORER = "https://explorer.near-intents.org";
export const intentTx = (hash: string) => `${INTENTS_EXPLORER}/transactions/${hash}`;
export const attestation = (callId: string) => `${OUTLAYER_API}/attestations/by-call/${callId}`;
/** Second explorer for when nearblocks is blocked (it sits behind Cloudflare, which can refuse automated browsers). */
export const ALT_EXPLORER = "https://pikespeak.ai";
export const txAlt = (h: string) => `${ALT_EXPLORER}/transaction-viewer/${h}`;
export const acctAlt = (a: string) => `${ALT_EXPLORER}/wallet-explorer/${a}`;

/**
 * Pledge (sealed-floor borrow) live wiring. OFF in production until the reviewed contract + worker
 * ship and the audit gate clears. When false, /pledge renders a labelled preview: no live chain
 * reads are presented as balances, and the primary CTA stays disabled.
 * Set NEXT_PUBLIC_PLEDGE_LIVE=1 only in explicit staging after the gate.
 */
export const PLEDGE_LIVE = process.env.NEXT_PUBLIC_PLEDGE_LIVE === "1";

/** Separate write gate. Default OFF; enable only after exact contract/worker/UI release review. */
export const PLEDGE_TRANSACTIONS = process.env.NEXT_PUBLIC_PLEDGE_TRANSACTIONS === "1";
