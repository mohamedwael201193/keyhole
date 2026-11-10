#!/usr/bin/env node
// verify-claims.mjs: check every claim in docs/claims.json, read-only.
// Uses public NEAR RPC, OutLayer, FastFS, the live site and the GitHub API. No keys, no writes, no spending.
// usage: node judge/verify-claims.mjs [--only <id>] [--offline] [--json]
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkTxOutcome } from "./tx-outcome.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(readFileSync(join(ROOT, "docs/claims.json"), "utf8"));
const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const offline = args.includes("--offline");
// RPC fallback list: NEAR_RPC (if set), then FastNear, then rpc.mainnet.near.org, then archival nodes for old tx lookups.
const RPCS = [...new Set([process.env.NEAR_RPC, "https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org", doc.rpc, "https://archival-rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.near.org"].filter(Boolean))];
/** Errors that mean "this node cannot answer", not "the claim is false": try the next RPC. */
const RETRYABLE = /UNKNOWN_TRANSACTION|GARBAGE_COLLECTED|UNKNOWN_BLOCK|NO_SYNCED_BLOCKS|TIMEOUT|INTERNAL|HTTP|fetch failed|aborted|Unexpected token|json/i;
class InfraError extends Error {}
const CONTRACT = "keyhole-devmo.near";
const OUTLAYER = process.env.OUTLAYER_API || "https://api.outlayer.ai";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A rate limit (429) or a server error (5xx) says nothing about the claim, so after the retries it is an ERROR
// (source unreachable), never a FAIL. Retry-After is honoured when the server sends one.
async function get(url, opt = {}, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...opt, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) {
        if (i >= tries - 1) throw new InfraError(`${url}: HTTP ${r.status} after ${tries} tries`);
        const after = Number(r.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 2000 * (i + 1));
        continue;
      }
      return r;
    } catch (e) {
      if (e instanceof InfraError) throw e;
      if (i >= tries - 1) throw new InfraError(`${url}: ${e.message}`);
      await sleep(2000 * (i + 1));
    }
  }
}
async function rpc(method, params) {
  let last = "";
  for (const url of RPCS) {
    try {
      const r = await get(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (!r.ok) { last = `HTTP ${r.status} from ${url}`; continue; }
      const j = await r.json();
      if (j.error) { const name = j.error.cause?.name || j.error.message || "error"; if (RETRYABLE.test(name)) { last = `${name} from ${url}`; continue; } throw new Error(name); }
      return j.result;
    } catch (e) { if (e instanceof Error && !RETRYABLE.test(e.message)) throw e; last = `${e.message} from ${url}`; }
  }
  throw new InfraError(`no RPC could answer (${last})`);
}
const memo = new Map();
const once = (k, f) => { if (!memo.has(k)) memo.set(k, f()); return memo.get(k); };
async function view(method, a) {
  return once(`v:${method}:${JSON.stringify(a)}`, async () => {
    const res = await rpc("query", { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(a)).toString("base64") });
    return JSON.parse(Buffer.from(res.result).toString());
  });
}
const dig = (o, p) => (p ? p.split(".").reduce((x, k) => (x == null ? undefined : x[k]), o) : o);
const b58 = (buf) => { const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"; let n = BigInt("0x" + buf.toString("hex")), s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } return s; };
const sha = (b) => createHash("sha256").update(b).digest("hex");
function walk(d, out = []) { for (const f of readdirSync(d)) { const p = join(d, f); if (f === "node_modules" || f === "target" || f === ".next") continue; statSync(p).isDirectory() ? walk(p, out) : out.push(p); } return out; }
const homeHtml = () => once("home", async () => (await get("https://keyhole-seven.vercel.app/")).text());

const checks = {
  async path(c) { return existsSync(join(ROOT, c.path)) ? [true, c.path] : [false, `missing ${c.path}`]; },
  async grep(c) { const t = readFileSync(join(ROOT, c.path), "utf8"); return new RegExp(c.pattern, "m").test(t) ? [true, "match"] : [false, `no /${c.pattern}/ in ${c.path}`]; },
  async count(c) { const n = (readFileSync(join(ROOT, c.path), "utf8").match(new RegExp(c.pattern, "g")) || []).length; return [n >= c.value, `${n}`]; },
  async symbol(c) {
    const re = new RegExp(`\\b${c.name}\\b`);
    for (const d of c.dirs) { const p = join(ROOT, d); if (!existsSync(p)) continue; for (const f of walk(p)) if (/\.(rs|ts|tsx|mjs|js)$/.test(f) && re.test(readFileSync(f, "utf8"))) return [true, f.slice(ROOT.length + 1)]; }
    return [false, `${c.name} not found`];
  },
  async sha256(c) { const b = readFileSync(join(ROOT, c.path)); const h = sha(b); return [h === c.sha256 && (!c.bytes || b.length === c.bytes), `${h.slice(0, 8)} ${b.length} bytes`]; },
  async code_hash(c) {
    const a = await rpc("query", { request_type: "view_account", finality: "final", account_id: c.account });
    const local = b58(createHash("sha256").update(readFileSync(join(ROOT, c.wasm))).digest());
    return [a.code_hash === c.code_hash && local === c.code_hash, `chain ${a.code_hash} repo ${local}`];
  },
  async view(c) {
    const v = dig(await view(c.method, c.args), c.path);
    const s = JSON.stringify(v);
    if (c.op === "eq") return [JSON.stringify(c.value) === s || (typeof v === "string" && String(c.value) === v), s];
    if (c.op === "gte") return [Number(v) >= c.value, `live ${s}`];
    if (c.op === "nonempty") return [typeof v === "string" && v.length > 0, s?.slice(0, 80)];
    return [false, "bad op"];
  },
  async access_key(c) {
    const r = await once(`ak:${c.account}`, () => rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: c.account }));
    const k = r.keys.find((x) => x.public_key.startsWith(c.prefix));
    if (!k) return [false, `no key ${c.prefix}…`];
    const p = k.access_key.permission;
    if (c.full) return [p === "FullAccess", JSON.stringify(p)];
    const fc = p.FunctionCall; if (!fc) return [false, "not FunctionCall"];
    const ok = fc.receiver_id === c.receiver && JSON.stringify([...fc.method_names].sort()) === JSON.stringify([...c.methods].sort()) && (!c.max_allowance || (fc.allowance != null && BigInt(fc.allowance) <= BigInt(c.max_allowance)));
    return [ok, `${fc.receiver_id} [${fc.method_names}] allowance ${fc.allowance}`];
  },
  async holder(c) {
    try { const a = await rpc("query", { request_type: "view_account", finality: "final", account_id: c.account }); if (a.block_height) return [true, "funded account"]; } catch { /* implicit account not funded yet */ }
    const t = await view("nft_tokens_for_owner", { account_id: c.account }); return [t.length > 0, `${t.length} key(s): ${t.map((x) => x.token_id).join(",")}`]; },
  async account(c) { const a = await rpc("query", { request_type: "view_account", finality: "final", account_id: c.account }); return [!!a.block_height, `amount ${a.amount}`]; },
  async tx(c) {
    // No hardcoded sender: try the claim's sender/signer, then the receiver and the contract. Archival RPCs cover old txs.
    let r = null, miss = "", unknown = 0, tried = 0;
    for (const sender of [...new Set([c.sender, c.signer, c.receiver, CONTRACT].filter(Boolean))]) {
      tried++;
      try { r = await rpc("tx", { tx_hash: c.hash, sender_account_id: sender, wait_until: "NONE" }); break; } catch (e) { miss = e.message; if (!(e instanceof InfraError)) throw e; if (/UNKNOWN_TRANSACTION/.test(miss)) unknown++; }
    }
    // Every node (archival included) answered "unknown" for every sender: the chain says no such tx, so FAIL.
    if (!r && unknown === tried) return [false, "tx not found on mainnet (archival RPCs, every candidate sender)"];
    if (!r) throw new InfraError(`tx not found on any RPC with any sender (${miss})`);
    if (c.receiver && !r.receipts_outcome.some((o) => o.outcome.executor_id === c.receiver)) return [false, `no receipt on ${c.receiver}`];
    return checkTxOutcome(r, c);
  },
  async attestation(c) {
    const r = await get(`${OUTLAYER}/attestations/by-call/${c.call}`);
    if (!r.ok) return [false, `HTTP ${r.status}`];
    const a = await r.json();
    const ok = a.executed_wasm_sha256 === a.wasm_hash && (a.tdx_quote || "").length > 100 && (!c.wasm_prefix || a.executed_wasm_sha256.startsWith(c.wasm_prefix)) && (!c.project || a.project_id === c.project);
    return [ok, `${a.project_id} ${a.executed_wasm_sha256?.slice(0, 12)}`];
  },
  async fastfs(c) { const r = await get(`https://main.fastfs.io/keyhole-devmo.near/outlayer.near/${c.sha256}.wasm`); const b = Buffer.from(await r.arrayBuffer()); return [sha(b) === c.sha256 && (!c.bytes || b.length === c.bytes), `${sha(b).slice(0, 8)} ${b.length} bytes`]; },
  async http(c) { const r = await get(c.url); const t = c.contains ? await r.text() : ""; return [r.status === c.status && (!c.contains || t.includes(c.contains)), `HTTP ${r.status}`]; },
  async redirect(c) { const r = await get(c.url, { redirect: "manual" }); const l = r.headers.get("location") || ""; const abs = new URL(l, c.url).href; return [r.status >= 300 && r.status < 400 && abs === c.location, `${r.status} → ${abs}`]; },
  async header(c) { const r = await once(`h:${c.url}`, () => get(c.url)); const v = r.headers.get(c.header) || ""; return [v.includes(c.contains), v.slice(0, 60)]; },
  async site_vs_chain(c) {
    const h = (await homeHtml()).replace(/\\"/g, '"');
    if (c.field === "supply") {
      // The home stat counts keys held by people: nft_total_supply minus the tokens the contract account holds (its test key).
      const m = h.match(/"supply":(\d+)/);
      const total = Number(await view("nft_total_supply", {}));
      const own = Number(await view("nft_supply_for_owner", { account_id: "keyhole-devmo.near" }));
      return [m && Number(m[1]) === total - own, `site ${m?.[1]} chain ${total} - contract-held ${own}`];
    }
    const m = h.match(/"beats":"(\d+)"/); const live = (await view("config", {})).beats; return [m && m[1] === String(live), `site ${m?.[1]} chain ${live}`];
  },
  async ci_run(c) {
    const r = await get(`https://api.github.com/repos/${c.repo}/actions/runs/${c.run}`, { headers: { "user-agent": "keyhole-judge" } });
    if (r.status === 404) return [null, "repo not public yet (SKIP)"];
    const j = await r.json(); return [j.conclusion === "success", `${j.status}/${j.conclusion}`];
  },
};
const LIVE = new Set(["code_hash", "view", "access_key", "account", "holder", "tx", "attestation", "fastfs", "http", "redirect", "header", "site_vs_chain", "ci_run"]);

const list = doc.claims.filter((c) => !only || c.id === only);
let pass = 0, fail = 0, skip = 0, errs = 0; const failed = [], errored = [];
const results = new Array(list.length);
let next = 0;
async function worker() {
  while (next < list.length) {
    const i = next++; const c = list[i]; const fn = checks[c.check.type];
    let r;
    if (!fn) r = [false, `unknown check ${c.check.type}`];
    else if (offline && LIVE.has(c.check.type)) r = [null, "offline (SKIP)"];
    else { try { r = await fn(c.check); } catch (e) { r = e instanceof InfraError ? ["error", e.message] : [false, `error ${e.message}`]; } }
    results[i] = r;
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
list.forEach((c, i) => {
  const [ok, info] = results[i];
  // ERROR = we could not reach a source (infra), distinct from FAIL = the source answered and contradicts the claim.
  const tag = ok === "error" ? "ERROR" : ok === null ? "SKIP" : ok ? "PASS" : "FAIL";
  if (ok === "error") { errs++; errored.push(c.id); } else if (ok === null) skip++; else if (ok) pass++; else { fail++; failed.push(c.id); }
  console.log(`${tag} ${c.id}  ${info ?? ""}  [${c.where}]`);
});
console.log(`\n${list.length} claims: ${pass} PASS, ${fail} FAIL, ${errs} ERROR, ${skip} SKIP`);
if (failed.length) console.log("failed: " + failed.join(", "));
if (errored.length) console.log("error (source unreachable, not a failed claim): " + errored.join(", "));
process.exit(fail ? 1 : errs ? 2 : 0);
