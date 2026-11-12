import test from "node:test";
import assert from "node:assert/strict";
import { promoteWorkerLive } from "./promote-worker-live.mjs";

const h = (c) => c.repeat(64);
const id = { worker: { project: "p/keyhole", wasm_sha256: h("a"), bytes: 1, add_version_tx: "x", info_call: "y", previous_wasm_sha256: h("b"), historical_wasm_sha256: [h("c"), h("d")] } };
const args = { hash: h("e"), infoCall: "42f2c909-27db-4562-9a24-a0399c0f9a1d", tx: "9VNRDazN" + "v".repeat(36), bytes: 1349199, previous: [h("f")] };

test("promotes, keeps every earlier build as previous or historical, never duplicates", () => {
  const w = promoteWorkerLive(id, args);
  assert.equal(w.wasm_sha256, h("e"));
  assert.equal(w.previous_wasm_sha256, h("f"));
  assert.deepEqual(w.historical_wasm_sha256, [h("a"), h("b"), h("c"), h("d")]);
  assert.equal(w.info_call, args.infoCall);
  assert.equal(w.bytes, 1349199);
  assert.equal(w.project, "p/keyhole");
});
test("without --also-previous the old pin becomes previous", () => {
  const w = promoteWorkerLive(id, { ...args, previous: [] });
  assert.equal(w.previous_wasm_sha256, h("a"));
  assert.deepEqual(w.historical_wasm_sha256, [h("b"), h("c"), h("d")]);
});
test("rejects bad input and repeat promotion", () => {
  assert.throws(() => promoteWorkerLive(id, { ...args, hash: "abc" }));
  assert.throws(() => promoteWorkerLive(id, { ...args, infoCall: "nope" }));
  assert.throws(() => promoteWorkerLive(id, { ...args, tx: "short" }));
  assert.throws(() => promoteWorkerLive(id, { ...args, bytes: 0 }));
  assert.throws(() => promoteWorkerLive(id, { ...args, hash: h("a") }));
  assert.throws(() => promoteWorkerLive(id, { ...args, previous: [h("e")] }));
  assert.throws(() => promoteWorkerLive(id, { ...args, previous: ["zz"] }));
});
