/**
 * Signed-log mutation check. Imports the verifier and never opens the network.
 * A changed owner or a changed detail must fail closed.
 */
import { generateKeyPairSync, sign } from "node:crypto";
import { checkLog, detailHash, eventHash } from "../tee/worker/verify-log.mjs";

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

if (process.env.KEYHOLE_NETWORK) {
  console.error("refusing: readme-verify does not use the network");
  process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = signedFixture();
  if (!checkLog(doc).ok || !mutationsFail(doc)) {
    console.error("FAIL mutation verifier");
    process.exit(1);
  }
  console.log("PASS mutation verifier");
}
