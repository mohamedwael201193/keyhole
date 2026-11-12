// Pure transition for `gen-identity.mjs --promote-worker`: a worker republished on OutLayer under the same project UUID.
// Inputs are public facts recorded in docs/evidence (registry add_version tx, attested info call). Nothing is read from a chain here;
// the live registry hash is cross-checked at runtime by web/lib/liveRegistry.ts and by judge/0-live.sh.
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TX = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const must = (c, m) => { if (!c) throw new Error(m); };

/** @param id parsed identity.json  @param a {hash, infoCall, tx, bytes, previous: string[]} */
export function promoteWorkerLive(id, a) {
  must(HEX64.test(a.hash), "--promote-worker needs a 64-hex worker hash");
  must(UUID.test(a.infoCall || ""), "--info-call needs the attested info call uuid");
  must(TX.test(a.tx || ""), "--tx needs the add_version transaction hash");
  must(Number.isInteger(a.bytes) && a.bytes > 0, "--bytes needs the wasm size");
  const previous = a.previous ?? [];
  for (const p of previous) must(HEX64.test(p), "--also-previous needs 64-hex hashes");
  must(a.hash !== id.worker.wasm_sha256, "worker is already promoted to this hash");
  must(!previous.includes(a.hash), "the new worker cannot also be a previous version");
  // Most recently published previous build first; the old pin follows, then everything already recorded.
  const chain = [...previous, id.worker.wasm_sha256, id.worker.previous_wasm_sha256, ...(id.worker.historical_wasm_sha256 ?? [])];
  const seen = new Set([a.hash]);
  const ordered = chain.filter((h) => h && !seen.has(h) && seen.add(h));
  const [prev, ...historical] = ordered;
  return {
    ...id.worker,
    wasm_sha256: a.hash,
    bytes: a.bytes,
    add_version_tx: a.tx,
    info_call: a.infoCall,
    previous_wasm_sha256: prev,
    historical_wasm_sha256: historical,
  };
}
