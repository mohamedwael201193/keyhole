import {
  validatePost,
  requireThat as must,
  sha,
  CANDIDATE,
  WORKER,
  ROLLBACK,
  ACCOUNT,
  b58,
} from "./promotion-lib.mjs";
// Pure transition, called ONLY AFTER fresh RPC evidence validation by gen-identity.
export function promotedContract(id, e, artifact) {
  validatePost(e);
  must(
    sha(artifact) === CANDIDATE && artifact.length === 487260,
    "reviewed artifact mismatch",
  );
  must(
    id.contract.account === ACCOUNT &&
      [ROLLBACK, CANDIDATE].includes(id.contract.wasm_sha256) &&
      id.contract.minter === e.before.config.minter,
    "identity continuity mismatch",
  );
  return {
    ...id.contract,
    version: "2.6.0",
    bytes: artifact.length,
    code_hash: b58(Buffer.from(CANDIDATE, "hex")),
    wasm_sha256: CANDIDATE,
    deploy_tx: e.deploy_hash,
  };
}
export function promotedWorker(id, proof, e) {
  must(
    id.contract.wasm_sha256 === CANDIDATE &&
      proof.ctx.snapshot.code.sha256 === CANDIDATE &&
      proof.ctx.snapshot.config.minter === id.contract.minter,
    "promote reviewed contract before worker",
  );
  // Rotation must not drop a formerly accepted proof, including on idempotent promotion.
  const previous = id.worker.wasm_sha256 === WORKER
    ? id.worker.previous_wasm_sha256 : id.worker.wasm_sha256;
  const historical = [...new Set([
    ...(id.worker.historical_wasm_sha256 ?? []),
    id.worker.previous_wasm_sha256,
  ])].filter(hash => hash && hash !== WORKER && hash !== previous);
  return {
    ...id.worker,
    previous_wasm_sha256: previous,
    historical_wasm_sha256: historical,
    wasm_sha256: WORKER,
    bytes: 1085333,
    add_version_tx: proof.publication_tx,
    info_call: e.info.call_id,
  };
}
