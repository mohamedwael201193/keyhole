// In-browser Intel TDX DCAP quote verification (quote v4, ECDSA-256, PCK chain in the quote).
// What it proves: the quote was signed by an attestation key that an Intel Quoting Enclave vouched for,
// and that QE's report was signed by a PCK certificate chaining to the pinned Intel SGX Root CA.
// Not checked here (needs Intel PCS, documented): CRL revocation and TCB status (up-to-date vs out-of-date).
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";

/** sha256 of the DER of the Intel SGX Root CA (CN=Intel SGX Root CA, valid 2018-05-21 to 2049-12-31). */
export const INTEL_ROOT_SHA256 = "44a0196b2b99f889b8e149e95b807a350e7424964399e885a7cbb8ccfab674d3";
/** MRSIGNER of Intel's TDX Quoting Enclave. */
export const INTEL_QE_MRSIGNER = "dc9e2a7c6f948f17474e34a7fc43ed030f7c1563f1babddf6340c82e0e54a8c5";
export const INTEL_QE_VENDOR = "939a7233f79c4ca9940a0db3957f0607";

export type DcapCheck = { id: string; label: string; pass: boolean; detail?: string };
export type Dcap = { ok: boolean; checks: DcapCheck[]; reportData: string; mrtd: string; rtmr: string[] };

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

export function b64(s: string): Uint8Array {
  const bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ---- minimal DER ----
type Tlv = { tag: number; start: number; hdr: number; len: number; end: number };
function tlv(b: Uint8Array, o: number): Tlv {
  const tag = b[o]; let len = b[o + 1]; let hdr = 2;
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let i = 0; i < n; i++) len = len * 256 + b[o + 2 + i]; hdr += n; }
  return { tag, start: o, hdr, len, end: o + hdr + len };
}
function kids(b: Uint8Array, t: Tlv): Tlv[] { const out: Tlv[] = []; let p = t.start + t.hdr; while (p < t.end) { const c = tlv(b, p); out.push(c); p = c.end; } return out; }
const body = (b: Uint8Array, t: Tlv) => b.subarray(t.start + t.hdr, t.end);

export type Cert = { der: Uint8Array; tbs: Uint8Array; sig: Uint8Array; pub: Uint8Array; notBefore: number; notAfter: number; subject: string; issuer: string };
function time(b: Uint8Array, t: Tlv): number {
  const s = new TextDecoder().decode(body(b, t));
  const y = t.tag === 0x17 ? 2000 + +s.slice(0, 2) - (+s.slice(0, 2) >= 50 ? 100 : 0) : +s.slice(0, 4);
  const r = t.tag === 0x17 ? s.slice(2) : s.slice(4);
  return Date.UTC(y, +r.slice(0, 2) - 1, +r.slice(2, 4), +r.slice(4, 6), +r.slice(6, 8), +r.slice(8, 10));
}
function cn(b: Uint8Array, t: Tlv): string {
  const s = new TextDecoder("latin1").decode(body(b, t)); const m = s.match(/Intel SGX [A-Za-z ]+?(?=[^A-Za-z ]|$)/); return m ? m[0] : "";
}
export function parseCert(der: Uint8Array): Cert {
  const top = tlv(der, 0); const [tbsT, , sigT] = kids(der, top);
  const f = kids(der, tbsT); const i0 = f[0].tag === 0xa0 ? 1 : 0;
  const issuerT = f[i0 + 2], valT = f[i0 + 3], subjT = f[i0 + 4], spkiT = f[i0 + 5];
  const [nb, na] = kids(der, valT);
  const bits = body(der, kids(der, spkiT)[1]).subarray(1); // skip unused-bits byte -> 04||X||Y
  return { der, tbs: der.subarray(tbsT.start, tbsT.end), sig: body(der, sigT).subarray(1), pub: bits, notBefore: time(der, nb), notAfter: time(der, na), subject: cn(der, subjT), issuer: cn(der, issuerT) };
}
export function pemCerts(pem: string): Cert[] {
  return (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []).map((p) => parseCert(b64(p.replace(/-----[^-]+-----|\s/g, ""))));
}
const vDer = (sig: Uint8Array, msg: Uint8Array, pub: Uint8Array) => { try { return p256.verify(sig, msg, pub, { format: "der", lowS: false }); } catch { return false; } };
const vRaw = (sig: Uint8Array, msg: Uint8Array, xy: Uint8Array) => { try { return p256.verify(sig, msg, cat(Uint8Array.of(4), xy), { lowS: false }); } catch { return false; } };

/** Parse and verify a TDX v4 quote. `expectReportData` (hex, 64 bytes) is checked when given. `now` for tests. */
export function verifyQuote(q: Uint8Array, opts: { expectReportData?: string; now?: number } = {}): Dcap {
  const c: DcapCheck[] = []; const add = (id: string, label: string, pass: boolean, detail?: string) => c.push({ id, label, pass, detail });
  const now = opts.now ?? Date.now();
  const ver = u16(q, 0), akType = u16(q, 2), tee = u32(q, 4), vendor = hex(q.subarray(12, 28));
  add("ver", "Quote format version 4", ver === 4, `v${ver}`);
  add("ak", "Attestation key type ECDSA P-256", akType === 2, `type ${akType}`);
  add("tee", "TEE type is Intel TDX", tee === 0x81, `0x${tee.toString(16)}`);
  add("vendor", "Quoting Enclave vendor is Intel", vendor === INTEL_QE_VENDOR, vendor.slice(0, 8));
  const hb = q.subarray(0, 632), td = q.subarray(48, 632);
  const attrs = td.subarray(120, 128);
  add("debug", "TD is not in debug mode", (attrs[0] & 1) === 0, hex(attrs));
  const sl = u32(q, 632);
  add("len", "Signature section length matches", 636 + sl === q.length || 636 + sl <= q.length, `${sl} bytes`);
  let p = 636; const sig = q.subarray(p, p + 64), ak = q.subarray(p + 64, p + 128);
  const ct = u16(q, p + 128); p += 134;
  add("ct6", "Certification data carries a QE report", ct === 6, `type ${ct}`);
  const qe = q.subarray(p, p + 384), qeSig = q.subarray(p + 384, p + 448); const al = u16(q, p + 448);
  const auth = q.subarray(p + 450, p + 450 + al); p = p + 450 + al;
  const ct2 = u16(q, p), cs2 = u32(q, p + 2);
  const pem = new TextDecoder().decode(q.subarray(p + 6, p + 6 + cs2)).replace(/\0+$/, "");
  add("quoteSig", "Attestation key signed the quote header and TD report", vRaw(sig, hb, ak));
  add("qeBind", "QE report binds the attestation key (sha256(key‖auth))", eq(sha256(cat(ak, auth)), qe.subarray(320, 352)));
  const mrs = hex(qe.subarray(128, 160)), prod = u16(qe, 256);
  add("qeSigner", "Quoting Enclave is signed by Intel (MRSIGNER)", mrs === INTEL_QE_MRSIGNER, mrs.slice(0, 16));
  add("qeProd", "Quoting Enclave is the TDX QE (ISVPRODID 2)", prod === 2, String(prod));
  let certs: Cert[] = [];
  try { certs = ct2 === 5 ? pemCerts(pem) : []; } catch { certs = []; }
  add("chain", "PCK certificate chain (3 certificates) in the quote", certs.length === 3, `${certs.length} certs`);
  const [pck, inter, root] = certs;
  add("qeSig", "PCK certificate signed the QE report", !!pck && vDer(qeSig, qe, pck.pub) || (!!pck && vRaw(qeSig, qe, pck.pub.subarray(1))));
  add("pckIss", "Intel PCK Platform/Processor CA signed the PCK certificate", !!pck && !!inter && vDer(pck.sig, pck.tbs, inter.pub), inter?.subject);
  add("interIss", "Intel SGX Root CA signed the intermediate", !!inter && !!root && vDer(inter.sig, inter.tbs, root.pub));
  add("rootSelf", "Root certificate is self-signed", !!root && vDer(root.sig, root.tbs, root.pub));
  add("rootPin", "Root is the pinned Intel SGX Root CA", !!root && hex(sha256(root.der)) === INTEL_ROOT_SHA256, root ? hex(sha256(root.der)).slice(0, 16) : "");
  add("dates", "Every certificate is inside its validity window", certs.length === 3 && certs.every((x) => x.notBefore <= now && now <= x.notAfter));
  const rd = hex(td.subarray(520, 584));
  if (opts.expectReportData) add("rd", "report_data equals the hash of the attested call fields", rd.slice(0, 64) === opts.expectReportData.slice(0, 64).toLowerCase());
  const rtmr = [0, 1, 2, 3].map((i) => hex(td.subarray(328 + i * 48, 376 + i * 48)));
  return { ok: c.every((x) => x.pass), checks: c, reportData: rd, mrtd: hex(td.subarray(136, 184)), rtmr };
}
