import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64 } from "@/lib/dcap";
import { certSerial, converge, matchModule, matchTcbLevel, parseCrl, pckInfo, pcsUpstream, quoteParts, signedJson, verifyCollateral, type PcsInput } from "@/lib/pcs";

// Real Intel PCS collateral fetched 2026-11-02 18:38 UTC, and two real mainnet quotes from the same FMSPC.
const fx = JSON.parse(readFileSync(`${__dirname}/fixtures/pcs_intel.json`, "utf8"));
const NOW = Date.parse("2026-11-02T19:00:00Z");
const base: PcsInput = { pckCrl: fx.pckCrl, pckCrlChain: fx.pckCrlChain, rootCrl: b64(fx.rootCrl), tcbInfo: fx.tcbInfo, tcbChain: fx.tcbChain, qeIdentity: fx.qeIdentity, qeChain: fx.qeChain };
const quote = (id: string) => b64(JSON.parse(readFileSync(`${__dirname}/fixtures/att_${id}.json`, "utf8")).tdx_quote);
const q = quote("7882f97a");
const failed = (r: ReturnType<typeof verifyCollateral>) => r.checks.filter((c) => !c.pass).map((c) => c.id);
const tcbJson = JSON.parse(fx.tcbInfo).tcbInfo;

describe("Intel PCS collateral, real data", () => {
  it("the 452df1fd call (previous build, fixed fixture) passes all 12 collateral checks and Intel rates it UpToDate", () => {
    const r = verifyCollateral(q, base, { now: NOW });
    expect(r.checks).toHaveLength(12);
    expect(failed(r)).toEqual([]);
    expect([r.tcbStatus, r.moduleStatus, r.qeStatus]).toEqual(["UpToDate", "UpToDate", "UpToDate"]);
  });

  it("a call on the previous build, on a different machine of the same platform, also passes", () => {
    const r = verifyCollateral(quote("f4768da8"), base, { now: NOW });
    expect(failed(r)).toEqual([]);
    expect(pckInfo(quoteParts(quote("f4768da8")).pck).serial).not.toBe(pckInfo(quoteParts(q).pck).serial);
  });

  it("reads FMSPC, PCESVN and the 16 CPUSVN components from the PCK certificate (values match openssl asn1parse)", () => {
    const p = pckInfo(quoteParts(q).pck);
    expect(p.fmspc).toBe("b0c06f000000");
    expect(p.pceSvn).toBe(11);
    expect(p.cpuSvn).toEqual([4, 4, 2, 2, 4, 1, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(p.serial).toBe("596815565f9dc6adb6c755c28d69e27bf1c4db31");
  });

  it("parses the PCK CRL: issuer, update window and all 57 revoked serials (as openssl crl -text)", () => {
    const c = parseCrl(fx.pckCrl);
    expect(c.issuer).toBe("Intel SGX PCK Platform CA");
    expect(new Date(c.thisUpdate).toISOString()).toBe("2026-11-02T17:49:39.000Z");
    expect(new Date(c.nextUpdate).toISOString()).toBe("2026-12-02T17:49:39.000Z");
    expect(c.revoked).toHaveLength(57);
    expect(new Set(c.revoked).size).toBe(57);
  });

  it("parses the DER Root CA CRL with no revoked entries", () => {
    const c = parseCrl(b64(fx.rootCrl));
    expect(c.issuer).toBe("Intel SGX Root CA");
    expect(c.revoked).toEqual([]);
  });
});

describe("Intel PCS collateral, each tamper is caught by its own check", () => {
  it("one changed byte in the PCK CRL breaks only its signature", () => {
    const pem = fx.pckCrl as string; const i = pem.indexOf("\n", 40) + 30;
    const bad = pem.slice(0, i) + (pem[i] === "A" ? "B" : "A") + pem.slice(i + 1);
    expect(failed(verifyCollateral(q, { ...base, pckCrl: bad }, { now: NOW }))).toEqual(["pckCrlSig"]);
  });

  it("an edited TCB status in TCB Info breaks the TCB Info signature", () => {
    const bad = (fx.tcbInfo as string).replace('"tcbStatus":"OutOfDate"', '"tcbStatus":"UpToDate"');
    expect(bad).not.toBe(fx.tcbInfo);
    expect(failed(verifyCollateral(q, { ...base, tcbInfo: bad }, { now: NOW }))).toEqual(["tcbSig"]);
  });

  it("an edited QE identity breaks its signature", () => {
    const bad = (fx.qeIdentity as string).replace('"isvprodid":2', '"isvprodid":3');
    expect(failed(verifyCollateral(q, { ...base, qeIdentity: bad }, { now: NOW }))).toEqual(["qeIdSig", "qeIdMatch"]);
  });

  it("a TCB Info chain that does not end at the pinned Intel root is refused", () => {
    expect(failed(verifyCollateral(q, { ...base, tcbChain: fx.pckCrlChain }, { now: NOW }))).toEqual(["tcbSig"]);
  });

  it("Intel-signed TCB Info for another platform (FMSPC 90C06F000000) passes its signature but fails the platform match", () => {
    expect(failed(verifyCollateral(q, { ...base, tcbInfo: fx.otherTcbInfo, tcbChain: fx.otherTcbChain }, { now: NOW }))).toContain("tcbFor");
    expect(failed(verifyCollateral(q, { ...base, tcbInfo: fx.otherTcbInfo, tcbChain: fx.otherTcbChain }, { now: NOW }))).not.toContain("tcbSig");
  });

  it("the PCK CRL handed in as the Root CA CRL is refused", () => {
    expect(failed(verifyCollateral(q, { ...base, rootCrl: b64((fx.pckCrl as string).replace(/-----[^-]+-----|\s/g, "")) }, { now: NOW }))).toEqual(["rootCrl"]);
  });

  it("after the collateral's nextUpdate, every freshness check fails and signatures still verify", () => {
    expect(failed(verifyCollateral(q, base, { now: Date.parse("2026-12-03T00:00:00Z") }))).toEqual(["pckCrlDate", "tcbDate", "qeIdSig"]);
  });

  it("a different TDX module signer (MRSIGNERSEAM) fails the module check", () => {
    const t = q.slice(); t[48 + 64] ^= 1;
    expect(failed(verifyCollateral(t, base, { now: NOW }))).toEqual(["seam"]);
  });

  it("an older TDX module (ISVSVN 10 under TDX_01) is OutOfDate, and so is the platform verdict", () => {
    const t = q.slice(); t[48] = 10;
    const r = verifyCollateral(t, base, { now: NOW });
    expect([r.moduleStatus, r.tcbStatus]).toEqual(["OutOfDate", "OutOfDate"]);
    expect(failed(r)).toEqual(["tcbLevel"]);
  });

  it("a Quoting Enclave below Intel's minimum ISVSVN has no matching QE level", () => {
    const t = q.slice(); const p = 636 + 134 + 258; t[p] = 3; t[p + 1] = 0;
    const r = verifyCollateral(t, base, { now: NOW });
    expect(r.qeStatus).toBe("NoMatchingLevel");
    expect(failed(r)).toEqual(["qeTcb"]);
  });
});

describe("TCB matching rules (Intel QVL)", () => {
  const tee = (a: number[]) => Uint8Array.from([...a, ...Array(16 - a.length).fill(0)]);
  const cpu = [4, 4, 2, 2, 4, 1, 0, 5, 0, 0, 0, 0, 0, 0, 0, 0];

  it("one CPUSVN component below the top level falls to the next level, OutOfDate with its advisories", () => {
    const l = matchTcbLevel(tcbJson.tcbLevels, [3, ...cpu.slice(1)], 11, tee([14, 1, 4]))!;
    expect(l.tcbStatus).toBe("OutOfDate");
    expect(l.advisoryIDs).toContain("INTEL-SA-01192");
  });

  it("a PCESVN below every level matches nothing", () => {
    expect(matchTcbLevel(tcbJson.tcbLevels, cpu, 4, tee([14, 1, 4]))).toBeNull();
  });

  it("TDX components 0 and 1 are compared only when no module version is set", () => {
    const levels = [{ tcb: { sgxtcbcomponents: cpu.map((svn) => ({ svn })), pcesvn: 11, tdxtcbcomponents: tee([5, 0, 4]).reduce<{ svn: number }[]>((a, svn) => [...a, { svn }], []) }, tcbStatus: "UpToDate" }];
    expect(matchTcbLevel(levels, cpu, 11, tee([1, 1, 4]))).not.toBeNull();
    expect(matchTcbLevel(levels, cpu, 11, tee([1, 0, 4]))).toBeNull();
  });

  it("selects the module identity TDX_<TEE_TCB_SVN[1]> and none when the version byte is 0", () => {
    expect(matchModule(tcbJson.tdxModuleIdentities, tee([14, 1])).identity?.id).toBe("TDX_01");
    expect(matchModule(tcbJson.tdxModuleIdentities, tee([5, 3])).level?.tcbStatus).toBe("UpToDate");
    expect(matchModule(tcbJson.tdxModuleIdentities, tee([14, 0])).id).toBeNull();
    expect(matchModule(tcbJson.tdxModuleIdentities, tee([1, 1])).level).toBeNull();
  });

  it.each([
    ["UpToDate", "OutOfDate", "OutOfDate"], ["SWHardeningNeeded", "OutOfDate", "OutOfDate"],
    ["ConfigurationNeeded", "OutOfDate", "OutOfDateConfigurationNeeded"], ["UpToDate", "Revoked", "Revoked"],
    ["OutOfDate", "UpToDate", "OutOfDate"], ["UpToDate", null, "UpToDate"],
  ])("converges platform %s with module %s to %s", (p, m, want) => expect(converge(p, m)).toBe(want));

  it("signs over the raw tcbInfo bytes, not a re-serialisation", () => {
    const s = signedJson(fx.tcbInfo, "tcbInfo");
    expect(new TextDecoder().decode(s.msg)).toBe((fx.tcbInfo as string).slice('{"tcbInfo":'.length, (fx.tcbInfo as string).lastIndexOf(',"signature"')));
    expect(s.sig).toHaveLength(64);
  });

  it("reads the PCK Platform CA serial for the Root CA CRL lookup (as openssl x509 -serial)", () => {
    expect(certSerial(quoteParts(q).inter)).toBe("956f5dcdbd1be1e94049c9d4f433ce01570bde54");
  });
});

describe("/api/pcs pass-through allowlist", () => {
  it("maps each kind to one fixed Intel URL and its issuer-chain header", () => {
    expect(pcsUpstream("pckcrl")?.url).toBe("https://api.trustedservices.intel.com/sgx/certification/v4/pckcrl?ca=platform");
    expect(pcsUpstream("qe")?.chainHeader).toBe("SGX-Enclave-Identity-Issuer-Chain");
    expect(pcsUpstream("rootcrl")).toEqual({ url: "https://certificates.trustedservices.intel.com/IntelSGXRootCA.der", chainHeader: null, binary: true });
    expect(pcsUpstream("tcb", "b0c06f000000")?.url).toBe("https://api.trustedservices.intel.com/tdx/certification/v4/tcb?fmspc=B0C06F000000");
  });
  it("refuses unknown kinds and any FMSPC that is not 12 hex characters", () => {
    for (const [k, f] of [["x", null], ["tcb", null], ["tcb", "b0c06f00000"], ["tcb", "b0c06f000000&x=1"], ["tcb", "../../evil0"]] as const) expect(pcsUpstream(k, f)).toBeNull();
  });
});
