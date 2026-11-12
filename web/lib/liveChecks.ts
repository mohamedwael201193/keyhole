/**
 * Read-only live checks for the judge Evidence and Attack pages.
 * Browser-side only: NEAR RPC, Nearblocks, OutLayer attestations. No signing, no value moves.
 */
import { CONTRACT_CODE_HASH, KEYS_CONTRACT, OUTLAYER_API, RPC_URL, WORKER_WASM_SHA256, attestation } from "./config";
import { IDENTITY } from "./identity.gen";
import { PUBLISHED_INFO_CALL } from "./evidence";

const RPCS = [RPC_URL, "https://free.rpc.fastnear.com"];

async function rpc<T>(method: string, params: unknown, timeoutMs = 12_000): Promise<T> {
  let last: unknown;
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({ jsonrpc: "2.0", id: "kh-live", method, params }),
      });
      const j = (await r.json()) as { result?: T; error?: { message?: string; cause?: { name?: string } } };
      if (j.error) throw new Error(j.error.cause?.name || j.error.message || "rpc");
      return j.result as T;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("rpc");
}

async function viewAccount(accountId: string) {
  return rpc<{ code_hash?: string; amount?: string; storage_usage?: number }>("query", {
    request_type: "view_account",
    finality: "final",
    account_id: accountId,
  });
}

async function viewAccessKeyList(accountId: string) {
  return rpc<{ keys: { public_key: string; access_key: { permission: string | { FunctionCall?: unknown } } }[] }>("query", {
    request_type: "view_access_key_list",
    finality: "final",
    account_id: accountId,
  });
}

async function callFunction<T>(accountId: string, methodName: string, args: Record<string, unknown> = {}): Promise<T> {
  const args_base64 = btoa(JSON.stringify(args));
  const result = await rpc<{ result: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64,
  });
  if (result.error) throw new Error(result.error);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(result.result))) as T;
}

export type LiveRow = {
  id: string;
  claim: string;
  how: string;
  ok: boolean | null;
  detail: string;
  href?: string;
};

/** Contract code hash equals identity.json. */
export async function checkContractCodeHash(): Promise<LiveRow> {
  const how = `NEAR RPC query view_account final · account_id=${KEYS_CONTRACT}`;
  try {
    const a = await viewAccount(KEYS_CONTRACT);
    const ch = a.code_hash ?? "";
    const ok = ch === CONTRACT_CODE_HASH;
    return {
      id: "contract-code",
      claim: `Contract ${KEYS_CONTRACT} code hash matches identity.json`,
      how,
      ok,
      detail: ok
        ? `Live code_hash ${ch.slice(0, 12)}… equals identity.contract.code_hash.`
        : `Live ${ch.slice(0, 12) || "(none)"}… ≠ identity ${CONTRACT_CODE_HASH.slice(0, 12)}….`,
      href: `https://nearblocks.io/address/${KEYS_CONTRACT}`,
    };
  } catch (e) {
    return { id: "contract-code", claim: `Contract ${KEYS_CONTRACT} code hash matches identity.json`, how, ok: false, detail: `RPC failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

/** Operator account access keys (honesty). */
export async function checkOperatorKeys(): Promise<LiveRow> {
  const how = `NEAR RPC query view_access_key_list final · account_id=${KEYS_CONTRACT}`;
  try {
    const list = await viewAccessKeyList(KEYS_CONTRACT);
    const full = list.keys.filter((k) => k.access_key.permission === "FullAccess").length;
    const fc = list.keys.length - full;
    const ok = full === 2;
    return {
      id: "operator-keys",
      claim: `${KEYS_CONTRACT} has exactly two FullAccess keys (documented in SECURITY.md §11)`,
      how,
      ok,
      detail: `Live: ${full} FullAccess, ${fc} FunctionCall (total ${list.keys.length}).`,
      href: `https://nearblocks.io/address/${KEYS_CONTRACT}`,
    };
  } catch (e) {
    return { id: "operator-keys", claim: `${KEYS_CONTRACT} has exactly two FullAccess keys`, how, ok: false, detail: `RPC failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

/** NFT total supply readable on mainnet. */
export async function checkNftSupply(): Promise<LiveRow> {
  const how = `NEAR RPC call_function nft_total_supply · ${KEYS_CONTRACT}`;
  try {
    const supply = await callFunction<string>(KEYS_CONTRACT, "nft_total_supply", {});
    const n = Number(supply);
    const ok = Number.isFinite(n) && n >= 1;
    return {
      id: "nft-supply",
      claim: "NEP-171 keys exist on mainnet (nft_total_supply ≥ 1)",
      how,
      ok,
      detail: ok ? `Live supply = ${supply}.` : `Unexpected supply ${supply}.`,
      href: `https://nearblocks.io/address/${KEYS_CONTRACT}`,
    };
  } catch (e) {
    return { id: "nft-supply", claim: "NEP-171 keys exist on mainnet", how, ok: false, detail: `RPC failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

/** The recorded info attestation matches the identity.json worker pin (not the live registry). */
export async function checkWorkerAttestation(callId = PUBLISHED_INFO_CALL): Promise<LiveRow> {
  const how = `GET ${OUTLAYER_API}/attestations/by-call/<call_id> · compare executed_wasm_sha256 to the identity.json pin (the repo's recorded info call, not the live registry)`;
  try {
    const r = await fetch(attestation(callId), { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { executed_wasm_sha256?: string; call_id?: string; tdx_quote?: string };
    const h = String(j.executed_wasm_sha256 || "").toLowerCase();
    const ok = h === WORKER_WASM_SHA256[0] && !!j.tdx_quote;
    return {
      id: "worker-attestation",
      claim: `Repo-pinned worker ${WORKER_WASM_SHA256[0].slice(0, 8)} attested (recorded info call; see the live registry on /verify)`,
      how,
      ok,
      detail: ok
        ? `Call ${callId.slice(0, 8)}… executed_wasm ${h.slice(0, 8)}… has a TDX quote.`
        : `Call returned wasm ${h.slice(0, 8) || "(none)"}… (repo pin ${WORKER_WASM_SHA256[0].slice(0, 8)}…).`,
      href: `/verify?call=${encodeURIComponent(callId)}`,
    };
  } catch (e) {
    return { id: "worker-attestation", claim: "Repo-pinned worker attested", how, ok: false, detail: `Attestation fetch failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

/** One evidence NEAR tx via Nearblocks (read-only). */
export async function checkNearTx(hash: string, claim: string, expectSuccess: boolean): Promise<LiveRow> {
  const how = "GET https://api.nearblocks.io/v3/txns/<hash> (Nearblocks index of mainnet)";
  const api = `https://api.nearblocks.io/v3/txns/${hash}`;
  try {
    const r = await fetch(api, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { data?: { outcomes?: { status?: boolean }; receiver_account_id?: string; signer_account_id?: string } };
    const t = j.data;
    if (!t || typeof t !== "object" || Array.isArray(t)) throw new Error("tx not indexed");
    const success = t.outcomes?.status === true;
    const ok = expectSuccess ? success : success === false;
    return {
      id: `tx-${hash.slice(0, 8)}`,
      claim,
      how,
      ok,
      detail: `Indexed status=${success ? "success" : "failure"}; signer ${t.signer_account_id ?? "?"} → ${t.receiver_account_id ?? "?"}.`,
      href: `https://nearblocks.io/txns/${hash}`,
    };
  } catch (e) {
    return { id: `tx-${hash.slice(0, 8)}`, claim, how, ok: false, detail: `Nearblocks failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

/** Live OutLayer attestation + published /evidence/<call>.json error.code must match the expected refusal. */
export async function checkAttestedRefusal(callId: string, expectKeyword: string, claim: string): Promise<LiveRow> {
  const how = `GET OutLayer by-call/${callId.slice(0, 8)}… + GET /evidence/${callId.slice(0, 8)}….json · expect error.code=${expectKeyword}`;
  try {
    const [attR, evR] = await Promise.all([
      fetch(attestation(callId), { signal: AbortSignal.timeout(20_000) }),
      fetch(`/evidence/${encodeURIComponent(callId)}.json`, { signal: AbortSignal.timeout(12_000) }),
    ]);
    if (!attR.ok) throw new Error(`attestation HTTP ${attR.status}`);
    if (!evR.ok) throw new Error(`evidence HTTP ${evR.status}`);
    const j = (await attR.json()) as { executed_wasm_sha256?: string; tdx_quote?: string; call_id?: string };
    const ev = (await evR.json()) as { call_id?: string; output?: { error?: { code?: string }; ok?: boolean } };
    const hasQuote = !!j.tdx_quote;
    const known = WORKER_WASM_SHA256.includes(String(j.executed_wasm_sha256 || "").toLowerCase());
    const code = String(ev.output?.error?.code || "");
    const idMatch = !ev.call_id || ev.call_id === callId;
    const ok = hasQuote && known && idMatch && code === expectKeyword;
    return {
      id: `refuse-${callId.slice(0, 8)}`,
      claim,
      how,
      ok,
      detail: ok
        ? `Live attestation (wasm ${(j.executed_wasm_sha256 || "").slice(0, 8)}…). Evidence error.code=${code}. Open /verify to re-check the quote.`
        : `Mismatch: quote=${hasQuote}, repo_list_build=${known}, evidence.code=${code || "(none)"} (want ${expectKeyword}).`,
      href: `/verify?call=${encodeURIComponent(callId)}`,
    };
  } catch (e) {
    return { id: `refuse-${callId.slice(0, 8)}`, claim, how, ok: false, detail: `Live check failed: ${e instanceof Error ? e.message : "error"}` };
  }
}

export async function runEvidencePack(): Promise<LiveRow[]> {
  const deployTx = IDENTITY.contract.deploy_tx;
  const publishTx = IDENTITY.worker.add_version_tx;
  const rows = await Promise.all([
    checkContractCodeHash(),
    checkOperatorKeys(),
    checkNftSupply(),
    checkWorkerAttestation(PUBLISHED_INFO_CALL),
    checkNearTx(deployTx, `Deploy tx ${deployTx.slice(0, 8)}… succeeded on mainnet`, true),
    checkNearTx(publishTx, `Worker add_version tx ${publishTx.slice(0, 8)}… succeeded on mainnet`, true),
    checkNearTx("G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD", "Key handover transfer A→B succeeded (ownership evidence)", true),
  ]);
  return rows;
}

export type AttackBuild = {
  /** First 8 hex chars of executed_wasm_sha256 from the recorded attestation. */
  wasm: string;
  /** True only when wasm matches identity.json current worker. Ready for future current-build refusals. */
  current: boolean;
};

export type AttackCase = {
  id: string;
  title: string;
  attempt: string;
  expected: string;
  kind: "attestation" | "tx";
  callId?: string;
  txHash?: string;
  keyword?: string;
  expectTxSuccess?: boolean;
  /** Worker build the recorded evidence ran on. Omitted only for pure chain txs. */
  build?: AttackBuild;
};

/** Badge label for a recorded attack case's worker build. */
export function attackBuildLabel(b: AttackBuild): string {
  return b.current
    ? `Recorded on current build · wasm ${b.wasm}`
    : `Recorded on previous build · wasm ${b.wasm}`;
}

export const ATTACK_CASES: AttackCase[] = [
  {
    id: "bad-recipient",
    title: "Pay the vault to someone else",
    attempt: "An obedient agent withdraws USDC to attacker.near while holding the key.",
    expected: "Enclave refuses bad_params (destination must be the signer).",
    kind: "attestation",
    callId: "c1312e2d-8c20-4b3e-ad5b-22dd3102826d",
    keyword: "bad_params",
    build: { wasm: "6367401a", current: false },
  },
  {
    id: "over-cap",
    title: "Drain past the per-trade cap",
    attempt: "Withdraw $2.00 while the holder's own per-trade cap was $0.002 (a custom cap set on Nov 1; the Bronze tier default is $1).",
    expected: "Enclave refuses over_cap_per_tx.",
    kind: "attestation",
    callId: "afaaf3e1-32ff-42d8-88da-412a0bb61e11",
    keyword: "over_cap_per_tx",
    build: { wasm: "6367401a", current: false },
  },
  {
    id: "replay",
    title: "Replay a captured signature",
    attempt: "Send the same signed request a second time.",
    expected: "Enclave refuses replay.",
    kind: "attestation",
    callId: "d8f5f0ee-3c0b-44bc-afed-bc24ad190ed0",
    keyword: "replay",
    build: { wasm: "6367401a", current: false },
  },
  {
    id: "tamper",
    title: "Edit the recipient, keep the signature",
    attempt: "Change params.to to attacker.near without re-signing.",
    expected: "Enclave refuses bad_signature.",
    kind: "attestation",
    callId: "16b09581-9010-4600-b5c5-58af0216cdc8",
    keyword: "bad_signature",
    build: { wasm: "6367401a", current: false },
  },
  {
    id: "not-owner",
    title: "Old holder after the key moved",
    attempt: "Previous owner signs a vault read after nft_transfer.",
    expected: "Enclave refuses not_owner.",
    kind: "attestation",
    callId: "711795b9-3e77-4a59-98ee-d798cb63ccc2",
    keyword: "not_owner",
    build: { wasm: "6367401a", current: false },
  },
  {
    id: "locked",
    title: "Withdraw while the key is frozen for sale",
    attempt: "Holder locks the key, then tries to withdraw.",
    expected: "Enclave refuses locked.",
    kind: "attestation",
    callId: "075287b5-a100-4fa5-8e96-94a36019c6bc",
    keyword: "locked",
    build: { wasm: "38bd67b9", current: false },
  },
  {
    id: "handover-tx",
    title: "The transfer that cut the old holder off",
    attempt: "nft_transfer of the key from A to B on mainnet.",
    expected: "Transaction succeeded; A's next vault call is not_owner.",
    kind: "tx",
    txHash: "G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD",
    expectTxSuccess: true,
  },
];
