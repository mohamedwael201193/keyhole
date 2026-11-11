/**
 * Deploy contracts/keys/release/v2.7 to a fresh NEAR testnet account.
 * Refuses any mainnet RPC or .near account. Writes the secret only to /tmp.
 */
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, KeyPairEd25519 } from "near-api-js";

if (process.env.KEYHOLE_DEPLOY_TRIAL !== "1") {
  console.error("Refusing to deploy. docs/trial/testnet.json is the recorded testnet contract. Set KEYHOLE_DEPLOY_TRIAL=1 to create another account.");
  process.exit(1);
}

const RPC = "https://rpc.testnet.near.org";
const FAUCET = "https://helper.nearprotocol.com/account";
if (!RPC.includes("testnet") || RPC.includes("mainnet")) throw new Error("refusing non-testnet RPC");

const wasmPath = "/agent/repos/keyhole/contracts/keys/release/v2.7/keyhole_keys.wasm";
const wasm = readFileSync(wasmPath);
const wasmSha = createHash("sha256").update(wasm).digest("hex");
const key = KeyPairEd25519.fromRandom();
const publicKey = key.publicKey.toString();
const accountId = `keyhole-trial-${Date.now().toString(36)}.testnet`;
if (!accountId.endsWith(".testnet") || accountId.endsWith(".near")) throw new Error("refusing non-testnet account");

const created = await fetch(FAUCET, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
});
const createdBody = await created.text();
if (!created.ok) throw new Error(`faucet ${created.status}: ${createdBody.slice(0, 300)}`);
const createdJson = JSON.parse(createdBody);
const createTx = createdJson?.transaction?.hash ?? null;
console.log("faucet_account", accountId);
console.log("faucet_tx", createTx);
console.log("faucet_status", createdJson.final_execution_status);

const secretKey = key.toString();
const secretPath = "/tmp/keyhole-trial-sponsor.json";
writeFileSync(secretPath, JSON.stringify({ accountId, secretKey }) + "\n", { mode: 0o600 });
chmodSync(secretPath, 0o600);
console.log("sponsor file written before deploy (secret not printed)");

const provider = new JsonRpcProvider({ url: RPC });
const account = new Account(accountId, provider, secretKey);

async function viewAccount() {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "view", method: "query",
      params: { request_type: "view_account", finality: "final", account_id: accountId },
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error?.cause?.name || j.error?.message || "view_account");
  return j.result;
}

for (let i = 0; i < 30; i++) {
  try { await viewAccount(); break; } catch (e) {
    if (i === 29) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function txHash(out) {
  return out?.transaction?.hash || out?.transaction_outcome?.id || null;
}
function failure(out) {
  const st = out?.status;
  if (st && typeof st === "object" && "Failure" in st) return JSON.stringify(st.Failure).slice(0, 500);
  return null;
}

console.log("deploying", wasm.length, "bytes");
const deployed = await account.deployContract(wasm);
const deployTx = txHash(deployed);
const deployFail = failure(deployed);
console.log("deploy_tx", deployTx);
if (deployFail) throw new Error(`deploy failed: ${deployFail}`);

const init = await account.callFunctionRaw({
  contractId: accountId,
  methodName: "new",
  args: { owner: accountId, minter: accountId, treasury: accountId, royalty_bps: 500 },
  gas: "100000000000000",
  waitUntil: "FINAL",
});
const initTx = txHash(init);
const initFail = failure(init);
console.log("init_tx", initTx);
if (initFail) throw new Error(`new() failed: ${initFail}`);

async function view(method, args = {}) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "viewfn", method: "query",
      params: {
        request_type: "call_function", finality: "final", account_id: accountId, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
      },
    }),
  });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(j.error?.cause?.name || j.result?.error || "view");
  return JSON.parse(Buffer.from(j.result.result).toString("utf8"));
}

const cost = await view("payout_storage_cost");
console.log("payout_storage_cost", cost);
const reg = await account.callFunctionRaw({
  contractId: accountId,
  methodName: "register_payout_account",
  args: { account_id: accountId },
  deposit: typeof cost === "string" ? cost : String(cost),
  gas: "80000000000000",
  waitUntil: "FINAL",
});
const regTx = txHash(reg);
const regFail = failure(reg);
console.log("register_tx", regTx);
if (regFail) throw new Error(`register failed: ${regFail}`);

const chain = await viewAccount();
const config = await view("config");
const meta = await view("nft_metadata");
const supply = await view("nft_total_supply");
const balance = await account.getBalance();
console.log("code_hash", chain.code_hash);
console.log("config", JSON.stringify(config));
console.log("metadata", JSON.stringify(meta));
console.log("supply", supply);
console.log("balance_yocto", balance.toString());

const publicRecord = {
  network: "testnet",
  account: accountId,
  code_hash: chain.code_hash,
  wasm_sha256: wasmSha,
  wasm_bytes: wasm.length,
  wasm: "contracts/keys/release/v2.7/keyhole_keys.wasm",
  version: "2.7.0",
  init: "new",
  royalty_bps: 500,
  owner: accountId,
  minter: accountId,
  treasury: accountId,
  payout_registered: true,
  rpc: ["https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"],
  explorer: `https://testnet.nearblocks.io/address/${accountId}`,
  transactions: { create: createTx, deploy: deployTx, init: initTx, register_payout: regTx },
  guest_accounts: "The server calls testnet.create_account with the visitor public key. The deposit is GUEST_DEPOSIT_YOCTO in web/lib/trialPublic.ts (0.05 testnet NEAR per guest). The secret key is generated in the browser. The sponsor key is the server env var KEYHOLE_TESTNET_SPONSOR_SECRET.",
  recorded_mainnet_trade: {
    label: "recorded on mainnet",
    call_id: "09d58c09-c1e9-48b6-bebb-485f5ae79539",
    evidence: "docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json",
  },
};
writeFileSync("/agent/repos/keyhole/docs/trial/testnet.json", JSON.stringify(publicRecord, null, 2) + "\n");
console.log("wrote docs/trial/testnet.json");
