/**
 * Signed-log mutation check. Imports the verifier and never opens the network.
 * A changed owner or a changed detail must fail closed.
 */
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { checkLog, checkProof, detailHash, eventHash } from "../tee/worker/verify-log.mjs";

const zero = "0".repeat(64);

export function signedFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const detail = "mint";
  const ev = { i: 0, prev: zero, kind: "mint", token_id: "kabc", owner: "alice.near", ts_ms: 10, detail_hash: detailHash(detail), detail };
  const head = eventHash(ev);
  const sig = sign(null, Buffer.from(head), privateKey).toString("hex");
  const minter = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  return { head, sig, minter, events: [ev] };
}

export function mutationsFail(doc = signedFixture()) {
  const owner = checkLog({ ...doc, events: [{ ...doc.events[0], owner: "bob.near" }] });
  const detail = checkLog({ ...doc, events: [{ ...doc.events[0], detail: "changed" }] });
  return owner.ok === false && detail.ok === false;
}

function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

const sha = (s) => createHash("sha256").update(s).digest("hex");

/** Recorded prove output. The attested output hash and the statement signature both reject a changed body. No network. */
export function recordedBindingHolds() {
  const ev = JSON.parse(readFileSync(new URL("../web/public/evidence/7420f66a-23d5-4a7d-9949-87056088ddda.json", import.meta.url), "utf8"));
  const pins = JSON.parse(readFileSync(new URL("../web/tests/fixtures/attested-hashes.json", import.meta.url), "utf8"));
  const pin = pins[ev.call_id];
  const output = ev.output;
  const bound = sha(canonical(output)) === pin.output_hash;
  const proof = checkProof({ statement: output.statement, sig: output.sig, minter: output.minter });
  const flipped = { ...output, holds_at_least: false };
  const bodyMoved = sha(canonical(flipped)) !== pin.output_hash;
  const statement = output.statement.replace('"holds_at_least":true', '"holds_at_least":false');
  const proofMoved = checkProof({ statement, sig: output.sig, minter: output.minter }).ok === false;
  const ownerMoved = checkProof({ statement: output.statement.replace(JSON.parse(output.statement).owner, "0".repeat(64)), sig: output.sig, minter: output.minter }).ok === false;
  return bound && proof.ok === true && proof.statement.log_head.length === 64 && bodyMoved && proofMoved && ownerMoved;
}

if (process.env.KEYHOLE_NETWORK) {
  console.error("refusing: readme-verify does not use the network");
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = signedFixture();
  if (!checkLog(doc).ok || !mutationsFail(doc) || !recordedBindingHolds()) {
    console.error("FAIL mutation verifier");
    process.exit(1);
  }
  console.log("PASS mutation verifier");
}
