import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64, verifyQuote } from "@/lib/dcap";
import { localChecks, tamperAttestation, type Attestation } from "@/lib/verify";

// Real mainnet attestation (call f4768da8, build 6367401a). Each negative control must turn exactly
// the checks it attacks red and leave the others green, so a judge can see the checker is not a stamp.
const a = JSON.parse(readFileSync(`${__dirname}/fixtures/att_f4768da8.json`, "utf8")) as Attestation;
const FASTFS = a.executed_wasm_sha256;
const NOW = Date.parse("2026-11-02T12:00:00Z");
async function run(x: Attestation) {
  const ck = await localChecks(x, FASTFS, FASTFS);
  const d = verifyQuote(b64(x.tdx_quote), { expectReportData: ck.binding?.expected, now: NOW });
  return { registered: ck.registered, published: ck.published, fastfs: ck.fastfs, binding: ck.binding?.match ?? false, dcap: d.ok,
    failed: d.checks.filter((c) => !c.pass).map((c) => c.id) };
}

describe("negative controls on /verify", () => {
  it("the untouched call passes every local check", async () => {
    expect(await run(a)).toMatchObject({ registered: true, published: true, fastfs: true, binding: true, dcap: true, failed: [] });
  });
  it("one byte of the TD report breaks only the quote signature", async () => {
    const r = await run(tamperAttestation(a, "quote"));
    expect(r).toMatchObject({ binding: true, registered: true, dcap: false });
    expect(r.failed).toEqual(["quoteSig"]);
  });
  it("one byte of report_data breaks the binding and the quote signature", async () => {
    const r = await run(tamperAttestation(a, "report_data"));
    expect(r).toMatchObject({ binding: false, dcap: false, registered: true });
    expect(r.failed).toEqual(["quoteSig", "rd"]);
  });
  it("an edited input hash breaks the binding but not the Intel signature", async () => {
    const r = await run(tamperAttestation(a, "input_hash"));
    expect(r).toMatchObject({ binding: false, registered: true, fastfs: true });
    expect(r.failed).toEqual(["rd"]);
  });
  it("claiming a different executed wasm fails registration, publication and the FastFS bytes", async () => {
    expect(await run(tamperAttestation(a, "executed_wasm"))).toMatchObject({ registered: false, published: false, fastfs: false, binding: true });
  });
  it("editing the registered wasm hash fails registration and the binding", async () => {
    expect(await run(tamperAttestation(a, "registered_wasm"))).toMatchObject({ registered: false, binding: false, published: true });
  });
});
