/**
 * Intel PCS collateral checks, run in the browser: PCK and Root CA revocation lists, TDX TCB Info and
 * TD QE Identity. The bytes come from Intel through a same-origin pass-through route; every signature is
 * checked here against the pinned Intel SGX Root CA, so the route cannot alter a verdict.
 * Matching follows Intel's TDX quote verification (the same rules as Intel QVL).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { b64, body, hex, INTEL_ROOT_SHA256, kids, pemCerts, time, tlv, u16, u32, vDer, vRaw, type Cert, type DcapCheck } from "./dcap";

export type PcsInput = {
  pckCrl: string; pckCrlChain: string; rootCrl: Uint8Array;
  tcbInfo: string; tcbChain: string; qeIdentity: string; qeChain: string;
};
export type Pcs = { ok: boolean; checks: DcapCheck[]; tcbStatus: string; moduleStatus: string | null; qeStatus: string; advisories: string[]; fmspc: string };
export const PCS_KINDS = ["pckcrl", "rootcrl", "tcb", "qe"] as const;
export const FMSPC_RE = /^[0-9a-f]{12}$/i;

const SGX_EXT = "2a864886f84d010d01"; // 1.2.840.113741.1.13.1
const dec = new TextDecoder();

/** Fields of a TDX v4 quote needed for collateral matching. */
export function quoteParts(q: Uint8Array) {
  const td = q.subarray(48, 632);
  let p = 636 + 134;
  const qe = q.subarray(p, p + 384); const al = u16(q, p + 448); p = p + 450 + al;
  const cs = u32(q, p + 2);
  const certs = pemCerts(dec.decode(q.subarray(p + 6, p + 6 + cs)).replace(/\0+$/, ""));
  return {
    teeTcbSvn: td.subarray(0, 16), mrSignerSeam: td.subarray(64, 112), seamAttributes: td.subarray(112, 120),
    qeMiscselect: u32(qe, 16), qeAttributes: qe.subarray(48, 64), qeMrsigner: qe.subarray(128, 160), qeProdId: u16(qe, 256), qeSvn: u16(qe, 258),
    pck: certs[0], inter: certs[1],
  };
}

/** Serial number (hex, no leading zero bytes) and Intel SGX extension values of a PCK certificate. */
export function pckInfo(c: Cert) {
  const f = kids(c.der, kids(c.der, tlv(c.der, 0))[0]);
  const serial = certSerial(c);
  const ext = f.find((x) => x.tag === 0xa3);
  let sgx: Uint8Array | null = null;
  if (ext) for (const e of kids(c.der, kids(c.der, ext)[0])) {
    const [oid, ...rest] = kids(c.der, e);
    if (hex(body(c.der, oid)) === SGX_EXT) sgx = body(c.der, rest[rest.length - 1]);
  }
  if (!sgx) throw new Error("no SGX extension");
  const vals = new Map<string, Uint8Array>();
  const walk = (b: Uint8Array, t: ReturnType<typeof tlv>) => {
    for (const e of kids(b, t)) { const [oid, v] = kids(b, e); if (v.tag === 0x30) walk(b, v); else vals.set(hex(body(b, oid)), body(b, v)); }
  };
  walk(sgx, tlv(sgx, 0));
  const comp = (n: number) => vals.get(`${SGX_EXT}02${n.toString(16).padStart(2, "0")}`);
  const int = (b?: Uint8Array) => (b ? Array.from(b).reduce((a, x) => a * 256 + x, 0) : -1);
  const cpuSvn = Array.from({ length: 16 }, (_, i) => int(comp(i + 1)));
  return { serial, cpuSvn, pceSvn: int(comp(17)), fmspc: hex(vals.get(`${SGX_EXT}04`) ?? new Uint8Array()) };
}

/** Parse a DER or PEM X.509 CRL: signed bytes, signature, issuer CN, validity window, revoked serials. */
export function parseCrl(input: Uint8Array | string) {
  const der = typeof input === "string" ? b64(input.replace(/-----[^-]+-----|\s/g, "")) : input;
  const top = tlv(der, 0); const [tbsT, , sigT] = kids(der, top); const f = kids(der, tbsT);
  let i = f[0].tag === 0x02 ? 1 : 0;
  const issuerT = f[i + 1]; const thisU = f[i + 2]; let nextU = f[i + 3]; i += 4;
  if (!nextU || (nextU.tag !== 0x17 && nextU.tag !== 0x18)) { nextU = thisU; i -= 1; }
  const revoked = f[i] && f[i].tag === 0x30 ? kids(der, f[i]).map((e) => hex(body(der, kids(der, e)[0])).replace(/^(00)+(?=.)/, "")) : [];
  const iss = dec.decode(body(der, issuerT)).match(/Intel SGX [A-Za-z ]+?(?=[^A-Za-z ]|$)/)?.[0] ?? "";
  return { tbs: der.subarray(tbsT.start, tbsT.end), sig: body(der, sigT).subarray(1), issuer: iss, thisUpdate: time(der, thisU), nextUpdate: time(der, nextU), revoked };
}

/** An Intel issuer chain from a PCS header (URL-encoded PEM): leaf signed by the pinned root, root self-signed, both in date. */
function chainOk(pem: string, now: number): { ok: boolean; leaf?: Cert; root?: Cert } {
  let certs: Cert[] = [];
  try { certs = pemCerts(decodeURIComponent(pem)); } catch { return { ok: false }; }
  const [leaf, root] = certs;
  const ok = certs.length === 2 && hex(sha256(root.der)) === INTEL_ROOT_SHA256 && vDer(root.sig, root.tbs, root.pub) && vDer(leaf.sig, leaf.tbs, root.pub)
    && certs.every((c) => c.notBefore <= now && now <= c.notAfter);
  return { ok, leaf, root };
}

/** The exact signed bytes of the `key` object in an Intel collateral response, and its raw r||s signature. */
export function signedJson(text: string, key: "tcbInfo" | "enclaveIdentity") {
  const start = text.indexOf(`{"${key}":`); const end = text.lastIndexOf(`,"signature":"`);
  if (start !== 0 || end < 0) throw new Error("unexpected collateral shape");
  const msg = new TextEncoder().encode(text.slice(key.length + 4, end));
  const sig = text.slice(end + 14).replace(/"\}\s*$/, "");
  return { msg, sig: Uint8Array.from(sig.match(/../g) ?? [], (h) => parseInt(h, 16)), json: JSON.parse(text)[key] };
}

type Lvl = { tcb: { sgxtcbcomponents: { svn: number }[]; pcesvn: number; tdxtcbcomponents: { svn: number }[] }; tcbStatus: string; advisoryIDs?: string[] };
type ModLvl = { tcb: { isvsvn: number }; tcbStatus: string; advisoryIDs?: string[] };

/** First TCB level the platform meets (Intel order: highest first). TDX components 0–1 are skipped when a module version is set. */
export function matchTcbLevel(levels: Lvl[], cpuSvn: number[], pceSvn: number, tee: Uint8Array): Lvl | null {
  const skip = tee[1] > 0 ? 2 : 0;
  return levels.find((l) => l.tcb.sgxtcbcomponents.every((c, i) => cpuSvn[i] >= c.svn) && pceSvn >= l.tcb.pcesvn
    && l.tcb.tdxtcbcomponents.every((c, i) => i < skip || tee[i] >= c.svn)) ?? null;
}
/** TDX module level for TEE_TCB_SVN[0] under identity TDX_<TEE_TCB_SVN[1]>, or null when no module version is set. */
export function matchModule(ids: { id: string; mrsigner: string; attributes: string; attributesMask: string; tcbLevels: ModLvl[] }[], tee: Uint8Array) {
  if (tee[1] === 0) return { id: null, identity: null, level: null };
  const id = `TDX_${tee[1].toString(16).padStart(2, "0").toUpperCase()}`;
  const identity = ids.find((x) => x.id.toUpperCase() === id) ?? null;
  return { id, identity, level: identity?.tcbLevels.find((l) => tee[0] >= l.tcb.isvsvn) ?? null };
}
/** Intel's rule for folding the module status into the platform status. */
export function converge(platform: string, module: string | null) {
  if (!module) return platform;
  if (module === "Revoked") return "Revoked";
  if (module === "OutOfDate" && (platform === "UpToDate" || platform === "SWHardeningNeeded")) return "OutOfDate";
  if (module === "OutOfDate" && (platform === "ConfigurationNeeded" || platform === "ConfigurationAndSWHardeningNeeded")) return "OutOfDateConfigurationNeeded";
  return platform;
}
const masked = (have: Uint8Array, want: string, mask: string) => {
  const w = want.match(/../g)!.map((h) => parseInt(h, 16)), m = mask.match(/../g)!.map((h) => parseInt(h, 16));
  return w.length === have.length && m.every((x, i) => (have[i] & x) === (w[i] & x));
};

/** Verify Intel PCS collateral for a TDX quote. Each check is independent so the page can show exactly which one fails. */
export function verifyCollateral(q: Uint8Array, c: PcsInput, opts: { now?: number } = {}): Pcs {
  const now = opts.now ?? Date.now();
  const out: DcapCheck[] = []; const add = (id: string, label: string, pass: boolean, detail?: string) => out.push({ id, label, pass, detail });
  const parts = quoteParts(q); const pck = pckInfo(parts.pck);

  const crlChain = chainOk(c.pckCrlChain, now);
  let crl: ReturnType<typeof parseCrl> | null = null; try { crl = parseCrl(c.pckCrl); } catch { crl = null; }
  add("pckCrlSig", "Intel signed the PCK revocation list (chain to the pinned root)", !!crl && crlChain.ok && crl.issuer === parts.pck.issuer && vDer(crl.sig, crl.tbs, crlChain.leaf!.pub), crl?.issuer);
  add("pckCrlDate", "PCK revocation list is current", !!crl && crl.thisUpdate <= now && now <= crl.nextUpdate, crl ? new Date(crl.nextUpdate).toISOString().slice(0, 10) : "");
  add("pckNotRevoked", "This machine's PCK certificate is not revoked", !!crl && !crl.revoked.includes(pck.serial), crl ? `${crl.revoked.length} revoked, serial ${pck.serial.slice(0, 8)}` : "");

  let rc: ReturnType<typeof parseCrl> | null = null; try { rc = parseCrl(c.rootCrl); } catch { rc = null; }
  const interSerial = parts.inter ? certSerial(parts.inter) : "";
  add("rootCrl", "Intel Root CA revocation list is signed, current, and does not list the PCK CA", !!rc && rc.issuer === "Intel SGX Root CA" && !!crlChain.root && vDer(rc.sig, rc.tbs, crlChain.root.pub)
    && rc.thisUpdate <= now && now <= rc.nextUpdate && !rc.revoked.includes(interSerial), rc ? `${rc.revoked.length} revoked` : "");

  const tcbChain = chainOk(c.tcbChain, now);
  let tcb: { msg: Uint8Array; sig: Uint8Array; json: Record<string, unknown> } | null = null; try { tcb = signedJson(c.tcbInfo, "tcbInfo"); } catch { tcb = null; }
  const ti = tcb?.json as undefined | { id: string; fmspc: string; nextUpdate: string; issueDate: string; tcbLevels: Lvl[]; tdxModuleIdentities?: Parameters<typeof matchModule>[0]; tdxModule?: { mrsigner: string; attributes: string; attributesMask: string } };
  add("tcbSig", "Intel signed the TDX TCB Info (chain to the pinned root)", !!tcb && tcbChain.ok && tcbChain.leaf!.subject.startsWith("Intel SGX TCB Signing") && vRaw(tcb.sig, tcb.msg, tcbChain.leaf!.pub.subarray(1)), tcbChain.leaf?.subject);
  add("tcbFor", "TCB Info is for TDX on this machine's platform (FMSPC)", !!ti && ti.id === "TDX" && ti.fmspc.toLowerCase() === pck.fmspc, pck.fmspc.toUpperCase());
  add("tcbDate", "TCB Info is current", !!ti && Date.parse(ti.issueDate) <= now && now <= Date.parse(ti.nextUpdate), ti ? ti.nextUpdate.slice(0, 10) : "");

  const level = ti ? matchTcbLevel(ti.tcbLevels, pck.cpuSvn, pck.pceSvn, parts.teeTcbSvn) : null;
  const mod = ti?.tdxModuleIdentities ? matchModule(ti.tdxModuleIdentities, parts.teeTcbSvn) : { id: null, identity: null, level: null };
  const modRef = mod.identity ?? ti?.tdxModule;
  add("seam", "TDX module is signed by Intel (MRSIGNERSEAM, SEAM attributes)", !!modRef && hex(parts.mrSignerSeam) === modRef.mrsigner.toLowerCase() && masked(parts.seamAttributes, modRef.attributes, modRef.attributesMask), mod.id ?? "TDX module");
  const moduleStatus = mod.level?.tcbStatus ?? null;
  const tcbStatus = level ? converge(level.tcbStatus, moduleStatus) : "NoMatchingLevel";
  add("tcbLevel", "Platform TCB level is UpToDate", tcbStatus === "UpToDate", tcbStatus);

  const qeChain = chainOk(c.qeChain, now);
  let qi: { msg: Uint8Array; sig: Uint8Array; json: Record<string, unknown> } | null = null; try { qi = signedJson(c.qeIdentity, "enclaveIdentity"); } catch { qi = null; }
  const qj = qi?.json as undefined | { id: string; nextUpdate: string; issueDate: string; miscselect: string; miscselectMask: string; attributes: string; attributesMask: string; mrsigner: string; isvprodid: number; tcbLevels: { tcb: { isvsvn: number }; tcbStatus: string; advisoryIDs?: string[] }[] };
  add("qeIdSig", "Intel signed the TD Quoting Enclave identity (chain to the pinned root)", !!qi && qeChain.ok && vRaw(qi.sig, qi.msg, qeChain.leaf!.pub.subarray(1)) && !!qj && qj.id === "TD_QE" && Date.parse(qj.issueDate) <= now && now <= Date.parse(qj.nextUpdate), qj?.id);
  const miscMask = qj ? parseInt(qj.miscselectMask.match(/../g)!.reverse().join(""), 16) : 0;
  const miscWant = qj ? parseInt(qj.miscselect.match(/../g)!.reverse().join(""), 16) : 0;
  add("qeIdMatch", "Quoting Enclave matches Intel's identity (signer, product, attributes)", !!qj && hex(parts.qeMrsigner) === qj.mrsigner.toLowerCase() && parts.qeProdId === qj.isvprodid
    && ((parts.qeMiscselect & miscMask) >>> 0) === ((miscWant & miscMask) >>> 0) && masked(parts.qeAttributes, qj.attributes, qj.attributesMask));
  const qeLevel = qj?.tcbLevels.find((l) => parts.qeSvn >= l.tcb.isvsvn) ?? null;
  const qeStatus = qeLevel?.tcbStatus ?? "NoMatchingLevel";
  add("qeTcb", "Quoting Enclave TCB is UpToDate", qeStatus === "UpToDate", `${qeStatus} · ISVSVN ${parts.qeSvn}`);

  const advisories = [...new Set([...(level?.advisoryIDs ?? []), ...(mod.level?.advisoryIDs ?? []), ...(qeLevel?.advisoryIDs ?? [])])];
  return { ok: out.every((x) => x.pass), checks: out, tcbStatus, moduleStatus, qeStatus, advisories, fmspc: pck.fmspc };
}
/** Certificate serial as lowercase hex without leading zero bytes, the form CRL entries are compared in. */
export function certSerial(c: Cert) {
  const top = tlv(c.der, 0); const f = kids(c.der, kids(c.der, top)[0]); const i0 = f[0].tag === 0xa0 ? 1 : 0;
  return hex(body(c.der, f[i0])).replace(/^(00)+(?=.)/, "");
}

const INTEL_API = "https://api.trustedservices.intel.com";
/** The only upstream URLs the /api/pcs pass-through may fetch, with the header that carries each issuer chain. */
export function pcsUpstream(kind: string, fmspc?: string | null): { url: string; chainHeader: string | null; binary: boolean } | null {
  if (kind === "pckcrl") return { url: `${INTEL_API}/sgx/certification/v4/pckcrl?ca=platform`, chainHeader: "SGX-PCK-CRL-Issuer-Chain", binary: false };
  if (kind === "rootcrl") return { url: "https://certificates.trustedservices.intel.com/IntelSGXRootCA.der", chainHeader: null, binary: true };
  if (kind === "qe") return { url: `${INTEL_API}/tdx/certification/v4/qe/identity`, chainHeader: "SGX-Enclave-Identity-Issuer-Chain", binary: false };
  if (kind === "tcb" && fmspc && FMSPC_RE.test(fmspc)) return { url: `${INTEL_API}/tdx/certification/v4/tcb?fmspc=${fmspc.toUpperCase()}`, chainHeader: "TCB-Info-Issuer-Chain", binary: false };
  return null;
}

/** Browser side: fetch all collateral through the same-origin pass-through. Nothing returned is trusted until verifyCollateral checks it. */
const cache = new Map<string, Promise<PcsInput>>();
export function fetchCollateral(fmspc: string, get: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<PcsInput> {
  const hit = cache.get(fmspc);
  if (hit) return hit;
  const p = loadCollateral(fmspc, get);
  cache.set(fmspc, p);
  p.catch(() => cache.delete(fmspc));
  return p;
}
async function loadCollateral(fmspc: string, get: (u: string) => Promise<Response>): Promise<PcsInput> {
  const one = async (k: string) => { const r = await get(`/api/pcs?r=${k}${k === "tcb" ? `&fmspc=${fmspc}` : ""}`); const j = await r.json(); if (!j.ok) throw new Error(j.error?.code ?? "pcs"); return j as { body: string; chain: string }; };
  const [crl, root, tcb, qe] = await Promise.all([one("pckcrl"), one("rootcrl"), one("tcb"), one("qe")]);
  return { pckCrl: crl.body, pckCrlChain: crl.chain, rootCrl: b64(root.body), tcbInfo: tcb.body, tcbChain: tcb.chain, qeIdentity: qe.body, qeChain: qe.chain };
}
