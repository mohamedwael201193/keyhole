import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { keyFromString, type Key } from "../src/core.ts";
import { signReport, verifyReport, REPORT_RECIPIENT, REPORT_KIND, type SignedReport } from "../src/report.ts";

// A throwaway key generated inside the test. Never a real key.
const seed = new Uint8Array(randomBytes(32));
const reporter: Key = keyFromString("reporter.near", "ed25519:" + bs58.encode(seed));
const other: Key = keyFromString("reporter.near", "ed25519:" + bs58.encode(new Uint8Array(randomBytes(32))));
const EVIDENCE = "7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQcEM2vgKFUAfK";
const NOW = Date.parse("2026-11-07T12:00:00Z");
const report = (now = NOW, key: Key = reporter) =>
  signReport(key, { account: "scammer.near", reason: "drained agents that paid it", evidence_tx: EVIDENCE }, now);

test("a freshly signed report verifies and yields the fields the curator needs", () => {
  const r = verifyReport(report(), NOW);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.report.kind, REPORT_KIND);
    assert.equal(r.report.reporter, "reporter.near");
    assert.equal(r.report.account, "scammer.near");
    assert.equal(r.report.evidence_tx, EVIDENCE);
  }
});

test("a changed field breaks the signature", () => {
  const s = report();
  const tampered: SignedReport = { ...s, message: s.message.replace("scammer.near", "innocent.near") };
  assert.deepEqual(verifyReport(tampered, NOW), { ok: false, error: "bad signature" });
});

test("a report signed by another key is refused", () => {
  const s = report(NOW, other);
  // Keep the claimed public key, sign with the wrong one.
  const forged: SignedReport = { ...s, public_key: reporter.publicKey };
  assert.deepEqual(verifyReport(forged, NOW), { ok: false, error: "bad signature" });
});

test("wrong recipient, reporter mismatch, stale and future reports are refused", () => {
  const s = report();
  assert.equal(verifyReport({ ...s, recipient: "keyhole" }, NOW).ok, false);
  assert.equal(verifyReport({ ...s, account_id: "someone-else.near" }, NOW).ok, false);
  assert.deepEqual(verifyReport(s, NOW + 25 * 3_600_000), { ok: false, error: "report is stale or from the future" });
  assert.deepEqual(verifyReport(s, NOW - 3_600_000), { ok: false, error: "report is stale or from the future" });
});

test("evidence must be a NEAR transaction hash, and the reason must be short text", () => {
  const bad = (reason: string, evidence_tx: string) => verifyReport(signReport(reporter, { account: "x.near", reason, evidence_tx }, NOW), NOW);
  assert.equal(bad("reason", "demo").ok, false);
  assert.equal(bad("reason", "0OIl" + "a".repeat(40)).ok, false, "characters outside base58 are refused");
  assert.equal(bad("", EVIDENCE).ok, false);
  assert.equal(bad("x".repeat(281), EVIDENCE).ok, false);
  assert.equal(bad("ok", EVIDENCE).ok, true);
});

test("malformed fields are refused without throwing", () => {
  const s = report();
  assert.equal(verifyReport({ ...s, signature: "!!!" }, NOW).ok, false);
  assert.equal(verifyReport({ ...s, nonce: Buffer.alloc(31).toString("base64") }, NOW).ok, false);
  assert.equal(verifyReport({ ...s, public_key: "secp256k1:abc" }, NOW).ok, false);
  assert.equal(verifyReport({ ...s, message: "not json" }, NOW).ok, false);
  assert.equal(verifyReport({ ...s, message: JSON.stringify({ kind: "other" }) }, NOW).ok, false);
});

test("the signature is over the NEP-413 payload, so an ordinary tx signature cannot be replayed as a report", () => {
  const s = report();
  const raw = ed25519.sign(new Uint8Array(32), reporter.secret);
  assert.equal(verifyReport({ ...s, signature: Buffer.from(raw).toString("base64") }, NOW).ok, false);
  assert.equal(s.recipient, REPORT_RECIPIENT);
});
