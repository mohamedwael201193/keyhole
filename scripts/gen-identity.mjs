#!/usr/bin/env node
// Generates web/lib/identity.gen.ts and tee/worker/DEPLOYED_SHA256 from identity.json, and
// checks that identity.json agrees with contracts/keys/deployed (sha256 + base58 code hash).
// Also refreshes the <!-- IDENTITY:START --> … <!-- IDENTITY:END --> block in README.md.
// usage: node scripts/gen-identity.mjs [--promote-v26 POST.json | --promote-worker-v26 EVIDENCE.json --release-trust TRUST.json] [--check] [--promote-live <public-capture.json>] [--review-source <full-commit>]
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
// fileURLToPath (not .pathname): on Windows .pathname gives "/D:/..." and every read fails.
const root = fileURLToPath(new URL("..", import.meta.url));
const promotionFlags = [
  "--promote-live",
  "--promote-v26",
  "--promote-v27",
  "--promote-worker-v26",
  "--promote-worker",
].filter((f) => process.argv.includes(f));
if (
  promotionFlags.length > 1 ||
  (promotionFlags.length && process.argv.includes("--check"))
)
  throw Error("one explicit promotion mode; cannot combine with --check");
const id = JSON.parse(readFileSync(root + "identity.json", "utf8"));
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (hex) => {
  let n = BigInt("0x" + hex),
    s = "";
  while (n > 0n) {
    s = A[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
};
// Promotion is explicit and uses a finalized public receipt/view capture, never a candidate guess.
if (process.argv.includes("--promote-live")) {
  if(id.contract.version!=="2.5.0")throw Error("historical v2.5 path cannot overwrite v2.6 or later live identity");
  if (process.argv.includes("--check"))
    throw new Error("--check cannot promote a deployment");
  const evidencePath = process.argv[process.argv.indexOf("--promote-live") + 1];
  if (!evidencePath || evidencePath.startsWith("--"))
    throw new Error("--promote-live requires a public live-view JSON capture");
  const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
  const artifact = readFileSync(
    root + "contracts/keys/release/v2.5/keyhole_keys.wasm",
  );
  const digest = createHash("sha256").update(artifact).digest("hex");
  const view = (method) =>
    evidence.views.find((v) => v.method === method)?.result;
  if (
    evidence.code.sha256 !== digest ||
    evidence.code.bytes !== artifact.length ||
    evidence.account.code_hash !== b58(digest) ||
    view("contract_source_metadata")?.version !== "2.5.0"
  )
    throw new Error("live code/version does not match release artifact");
  for (const name of ["deploy", "migration"]) {
    const tx = evidence.transactions[name];
    if (
      tx?.final_execution_status !== "FINAL" ||
      !Object.hasOwn(tx.status, "SuccessValue") ||
      tx.transaction.signer_id !== id.contract.account ||
      tx.transaction.receiver_id !== id.contract.account ||
      tx.receipts_outcome.some((r) =>
        Object.hasOwn(r.outcome.status, "Failure"),
      )
    )
      throw new Error(`${name} is not a successful FINAL self-transaction`);
  }
  const deploy = evidence.transactions.deploy.transaction;
  const migration = evidence.transactions.migration.transaction;
  const deployAction = deploy.actions.find(
    (a) => a.DeployContract,
  )?.DeployContract;
  const migrateAction = migration.actions.find(
    (a) => a.FunctionCall?.method_name === "migrate_pledge",
  )?.FunctionCall;
  const migrationArgs =
    migrateAction &&
    JSON.parse(Buffer.from(migrateAction.args, "base64").toString());
  if (
    !deployAction ||
    Buffer.from(deployAction.code, "base64").toString("hex") !== digest ||
    !migrateAction ||
    migrateAction.deposit !== "0" ||
    migrationArgs.recovery_account !==
      view("get_pledge_config")?.recovery_account
  )
    throw new Error(
      "receipt actions do not prove this upgrade and recovery beneficiary",
    );
  id._doc =
    "Single source of truth for live identities. Generate deployment updates with node scripts/gen-identity.mjs --promote-live <public-capture.json>. Refresh generated files with the same script.";
  Object.assign(id.contract, {
    version: "2.5.0",
    bytes: artifact.length,
    code_hash: b58(digest),
    wasm_sha256: digest,
    deploy_tx: deploy.hash,
    migrate_pledge_tx: migration.hash,
    recovery_account: migrationArgs.recovery_account,
  });
  copyFileSync(
    root + "contracts/keys/release/v2.5/keyhole_keys.wasm",
    root + "contracts/keys/deployed/keyhole_keys.wasm",
  );
  writeFileSync(
    root + "contracts/keys/deployed/SHA256SUMS",
    `${digest}  keyhole_keys.wasm\n`,
  );
  writeFileSync(root + "identity.json", JSON.stringify(id, null, 2) + "\n");
}
// v2.7 promotion re-reads FINAL public evidence and uses immutable release bytes.
// Contract files (including historical deployed/v2.6 bytes) are never rewritten.
if (process.argv.includes("--promote-v27")) {
  const path=process.argv[process.argv.indexOf("--promote-v27")+1];
  if(!path || path.startsWith("--"))throw Error("public v2.7 evidence required");
  const {promoteV27}=await import("./release/promote-v27.mjs");
  id.contract=await promoteV27(id,JSON.parse(readFileSync(path,"utf8")),root);
  id.contract_candidate.status="deployed-mainnet";
  writeFileSync(root+"identity.json",JSON.stringify(id,null,2)+"\n");
}
// New promotion path: code-only v2.6. Historical migration evidence is retained.
if (
  process.argv.includes("--promote-v26") ||
  process.argv.includes("--promote-worker-v26")
) {
  if (
    process.argv.includes("--check") ||
    process.argv.includes("--promote-live") ||
    (process.argv.includes("--promote-v26") &&
      process.argv.includes("--promote-worker-v26"))
  )
    throw Error("one explicit promotion mode only");
  const { CANDIDATE, revalidatePost } = await import(
    "./release/promotion-lib.mjs"
  );
  const { promotedContract, promotedWorker } = await import(
    "./release/identity-promotion.mjs"
  );
  const flag = process.argv.includes("--promote-v26")
      ? "--promote-v26"
      : "--promote-worker-v26",
    path = process.argv[process.argv.indexOf(flag) + 1];
  if (!path || path.startsWith("--"))
    throw Error("public evidence JSON required");
  const e = JSON.parse(readFileSync(path, "utf8"));
  if (flag === "--promote-v26") {
    await revalidatePost(e);
    const artifact = readFileSync(
      root + "contracts/keys/release/v2.6/keyhole_keys.wasm",
    );
    if (
      createHash("sha256").update(artifact).digest("hex") !== CANDIDATE ||
      artifact.length !== 487260
    )
      throw Error("reviewed bytes changed");
    if (
      e.before.config.minter !== id.contract.minter ||
      e.after.pledge.attestor_public_key !== e.before.pledge.attestor_public_key
    )
      throw Error("immutable authority changed");
    id.contract = promotedContract(id, e, artifact);
    // Deliberately no assignment to migrate_pledge_tx or any initialized config.
    copyFileSync(
      root + "contracts/keys/release/v2.6/keyhole_keys.wasm",
      root + "contracts/keys/deployed/keyhole_keys.wasm",
    );
    writeFileSync(
      root + "contracts/keys/deployed/SHA256SUMS",
      CANDIDATE + "  keyhole_keys.wasm\n",
    );
  } else {
    const t = process.argv[process.argv.indexOf("--release-trust") + 1];
    if (!process.argv.includes("--release-trust") || !t || t.startsWith("--"))
      throw Error("reviewed release trust JSON required");
    const { workerPublication } = await import("./release/promote-v26.mjs");
    const proof = await workerPublication(
      e,
      JSON.parse(readFileSync(t, "utf8")),
    );
    if (proof.ctx.snapshot.config.minter !== id.contract.minter)
      throw Error("minter continuity failed");
    id.worker = promotedWorker(id, proof, e);
  }
  if (id.contract_candidate)
    id.contract_candidate.status = id.contract_candidate.wasm_sha256 === id.contract.wasm_sha256 ? "deployed-mainnet" : "source-candidate-not-deployed";
  if (id.worker_candidate?.wasm_sha256 === id.worker.wasm_sha256)
    id.worker_candidate.status = "published-mainnet";
  writeFileSync(root + "identity.json", JSON.stringify(id, null, 2) + "\n");
}
if (process.argv.includes("--review-source")) {
  if (process.argv.includes("--check"))
    throw new Error("--check cannot set review source");
  const source = process.argv[process.argv.indexOf("--review-source") + 1];
  if (!/^[a-f0-9]{40}$/.test(source ?? ""))
    throw new Error("--review-source requires an immutable full commit");
  id.review.source_commit = source;
  writeFileSync(root + "identity.json", JSON.stringify(id, null, 2) + "\n");
}
// Promote a worker republished under the same OutLayer project UUID, from public facts (see scripts/release/promote-worker-live.mjs).
// usage: --promote-worker <wasm sha256> --info-call <uuid> --tx <add_version tx> --bytes <n> [--also-previous <sha256>]...
if (process.argv.includes("--promote-worker")) {
  if (process.argv.includes("--check")) throw new Error("--check cannot promote a worker");
  const arg = (f) => { const i = process.argv.indexOf(f); return i < 0 ? undefined : process.argv[i + 1]; };
  const prev = process.argv.flatMap((v, i) => (v === "--also-previous" ? [process.argv[i + 1]] : []));
  const { promoteWorkerLive } = await import("./release/promote-worker-live.mjs");
  id.worker = promoteWorkerLive(id, { hash: arg("--promote-worker"), infoCall: arg("--info-call"), tx: arg("--tx"), bytes: Number(arg("--bytes")), previous: prev });
  id.worker_candidate = { status: "published-mainnet", wasm_sha256: id.worker.wasm_sha256, bytes: id.worker.bytes, recipe: "tee/worker/build.sh" };
  writeFileSync(root + "identity.json", JSON.stringify(id, null, 2) + "\n");
}
// Candidate generation never promotes an unpublished worker to the live identity.
if (process.argv.includes("--worker-candidate")) {
  const artifact = readFileSync(
    root + "tee/worker/target/wasm32-wasip2/release/keyhole-worker.wasm",
  );
  const candidate = {
    status:
      id.worker.wasm_sha256 ===
      createHash("sha256").update(artifact).digest("hex")
        ? "published-mainnet"
        : "source-candidate-not-published",
    wasm_sha256: createHash("sha256").update(artifact).digest("hex"),
    bytes: artifact.length,
    recipe: "tee/worker/build.sh",
  };
  if (process.argv.includes("--check")) {
    if (JSON.stringify(id.worker_candidate) !== JSON.stringify(candidate))
      throw new Error("worker candidate identity is stale");
  } else {
    id.worker_candidate = candidate;
    writeFileSync(root + "identity.json", JSON.stringify(id, null, 2) + "\n");
  }
}
// Separately reviewed contract candidate: never changes deployed/live identity.
if (process.argv.includes("--contract-candidate")) {
  const artifact = readFileSync(
    root + "contracts/keys/target/near/keyhole_keys.wasm",
  );
  const digest = createHash("sha256").update(artifact).digest("hex");
  const version = readFileSync(
    root + "contracts/keys/src/lib.rs",
    "utf8",
  ).match(/version = "([0-9.]+)"/)[1];
  const c = {
    status:
      id.contract.wasm_sha256 === digest
        ? "deployed-mainnet"
        : "source-candidate-not-deployed",
    version,
    release: "v" + version.split(".").slice(0, 2).join("."),
    wasm_sha256: digest,
    code_hash: b58(digest),
    bytes: artifact.length,
    recipe: "contracts/keys/build.sh",
  };
  const path = "contracts/keys/release/" + c.release + "/keyhole_keys.wasm";
  if (process.argv.includes("--check")) {
    if (
      JSON.stringify(id.contract_candidate) !== JSON.stringify(c) ||
      !readFileSync(root + path).equals(artifact)
    )
      throw Error("contract candidate byte equality failed");
  } else {
    id.contract_candidate = c;
    mkdirSync(root + "contracts/keys/release/" + c.release, {
      recursive: true,
    });
    writeFileSync(root + path, artifact);
    writeFileSync(root + "identity.json", JSON.stringify(id, null, 2) + "\n");
  }
}
const liveArtifact = id.contract.version === "2.7.0" ? "contracts/keys/release/v2.7/keyhole_keys.wasm" : "contracts/keys/deployed/keyhole_keys.wasm";
const wasm = readFileSync(root + liveArtifact);
const sha = createHash("sha256").update(wasm).digest("hex");
const errs = [];
if (sha !== id.contract.wasm_sha256)
  errs.push(
    `contract wasm sha256 ${sha} != identity ${id.contract.wasm_sha256}`,
  );
if (b58(id.contract.wasm_sha256) !== id.contract.code_hash)
  errs.push(
    `code_hash ${id.contract.code_hash} != base58(wasm_sha256) ${b58(id.contract.wasm_sha256)}`,
  );
if (!/^[0-9a-f]{64}$/.test(String(id.contract.minter || "")))
  errs.push("contract.minter must be the 64-hex implicit account");
if (
  !(id.contract.version === "2.7.0"
    ? readFileSync(root + "contracts/keys/release/SHA256SUMS", "utf8").includes(sha + "  v2.7/keyhole_keys.wasm")
    : readFileSync(root + "contracts/keys/deployed/SHA256SUMS", "utf8").startsWith(sha))
)
  errs.push("SHA256SUMS out of date");

const reviewRef = id.review?.source_commit;
if (!/^[0-9a-f]{40}$/.test(reviewRef ?? ""))
  errs.push("review.source_commit must be an immutable full Git commit");
const w = id.worker;
const k = id.contract;
const w8 = w.wasm_sha256.slice(0, 8);
const k8 = k.code_hash.slice(0, 8);
const tx8 = (s) => `${s.slice(0, 8)}…`;
const bytes = Number(w.bytes).toLocaleString("en-US");
const candidateWasm = readFileSync(
  root + "contracts/keys/release/v2.5/keyhole_keys.wasm",
);
const candidateSha = createHash("sha256").update(candidateWasm).digest("hex");
const contractLive = id.contract.wasm_sha256 === candidateSha;
const candidate = {
  status: contractLive ? "deployed-mainnet" : "historical-mainnet-release",
  release: "v2.5",
  wasm_sha256: candidateSha,
  code_hash: b58(candidateSha),
  bytes: candidateWasm.length,
  recipe: "contracts/keys/build.sh",
  rust: "1.86.0",
  cargo_near: "0.22.0",
  binaryen: "123",
};
const liveRelease = "v" + k.version.split(".").slice(0, 2).join(".");
const identityBlock = `<!-- IDENTITY:START -->
### Live mainnet identities

This block is generated from [\`identity.json\`](identity.json) by \`node scripts/gen-identity.mjs\`. Do not edit it by hand.

The live worker is \`${w8}\` (${bytes} bytes).

| Piece | Live value | Proof |
|---|---|---|
| Contract account | \`${k.account}\` | [nearblocks](https://nearblocks.io/address/${k.account}) |
| TEE minter | \`${k.minter}\` | [\`judge/0-live.sh\`](judge/0-live.sh) requires \`config.minter\` to equal this 64-hex implicit account |
| Contract version | \`${k.version ?? "2.4.0"}\` | NEP-330 \`contract_source_metadata\` |
| Pledge migration | \`${k.migrate_pledge_tx ? tx8(k.migrate_pledge_tx) : "not migrated"}\` | ${k.migrate_pledge_tx ? `[nearblocks](https://nearblocks.io/txns/${k.migrate_pledge_tx})` : "—"} |
| Contract code hash | \`${k.code_hash}\` | deploy tx [\`${tx8(k.deploy_tx)}\`](https://nearblocks.io/txns/${k.deploy_tx}) |
| Contract wasm sha256 | \`${k.wasm_sha256}\` | [\`${liveArtifact}\`](${liveArtifact}) |
| Worker project | \`${w.project}\` | |
| Worker wasm sha256 | \`${w.wasm_sha256}\` | [\`tee/worker/DEPLOYED_SHA256\`](tee/worker/DEPLOYED_SHA256) |
| Worker publish tx | \`${w.add_version_tx}\` | [nearblocks](https://nearblocks.io/txns/${w.add_version_tx}) |
| Live \`info\` call | \`${w.info_call}\` | [attestation](https://api.outlayer.ai/attestations/by-call/${w.info_call}) · [verify](https://keyhole-seven.vercel.app/verify?call=${w.info_call}) |

The contract release is **live on mainnet**. Release bytes and recipe are in [\`contracts/keys/release/${liveRelease}/identity.json\`](contracts/keys/release/${liveRelease}/identity.json). The worker identity is separate: updating the contract does not publish the guarded worker or enable lending.

| Contract release | Bytes | SHA256 | Code storage at 0.00001 NEAR/B |
|---|---:|---|---:|
| ${liveRelease} (live) | ${Number(k.bytes).toLocaleString("en-US")} | \`${k.wasm_sha256}\` | ${(k.bytes / 100000).toFixed(5)} NEAR |

Strict read-only online verification of the live deployment:

\`\`\`bash
CARGO_BUILD_JOBS=1 bash judge/1-contract.sh --strict
node judge/verify-claims.mjs --strict
\`\`\`

${id.worker_candidate ? `Worker source candidate: \`${id.worker_candidate.wasm_sha256}\` (${id.worker_candidate.bytes.toLocaleString("en-US")} bytes), generated from the pinned CI build (ubuntu-latest, rustc 1.99.1, tee/worker/build.sh); builds on other hosts may differ. [Candidate identity](docs/evidence/worker-provisioning/candidate.json) · [V2 phased provisioning](docs/worker/confinement-v2.md) · [Candidate validation](docs/evidence/worker-provisioning/v2/r3/validation.json) · [Authority regressions](tee/worker/src/collateral_evidence/tests.rs).\n\n` : ""}${id.contract_candidate ? `Contract source candidate **${id.contract_candidate.version}**, ${id.contract_candidate.wasm_sha256 === k.wasm_sha256 ? "matches live deployment" : "staged for deploy, not live"}: [generated release identity](contracts/keys/release/${id.contract_candidate.release}/identity.json). Its owner/epoch CAS is required before collateral provisioning. The original release-file candidate label is historical; current deployment is proved by [FINAL v2.7 evidence](docs/evidence/live-v2.7/promotion.public.json).\n\n` : ""}${id.governance ? `Live governance (\`governance_state\`, \`get_pledge_config\`): owner \`${id.governance.owner}\`; pending owner \`${id.governance.pending_owner}\`; pending_owner_not_before_ns \`${id.governance.pending_owner_not_before_ns}\`; staged_upgrade_sha256 \`${id.governance.staged_upgrade_sha256}\`; staged_upgrade_not_before_ns \`${id.governance.staged_upgrade_not_before_ns}\`; min_upgrade_delay_ns \`${id.governance.min_upgrade_delay_ns}\`; wind_down_ns \`${id.governance.wind_down_ns}\`; wound_down ${id.governance.wound_down}; lending_enabled ${id.governance.lending_enabled}. Access keys: ${id.governance.full_access_keys} FullAccess and ${id.governance.function_call_keys} FunctionCall (\`ed25519:7N1fLo9M…\`, \`ed25519:FNe2aYtz…\`). Stage [tx](https://nearblocks.io/txns/${id.governance.stage_upgrade_tx}) · owner proposal [tx](https://nearblocks.io/txns/${id.governance.propose_owner_tx}). The owner is the guardian implicit account; the contract account no longer owns the contract.\n\n` : ""}Measured size steps are in [\`docs/evidence/integration-stack/contract-size.md\`](docs/evidence/integration-stack/contract-size.md). Live public post-upgrade views and both FINAL receipt trees are in [\`docs/evidence/live-v2.5/all-live-views.json\`](docs/evidence/live-v2.5/all-live-views.json).
<!-- IDENTITY:END -->
`;

const ts = `// GENERATED by scripts/gen-identity.mjs from identity.json. Do not edit.
export const IDENTITY = ${JSON.stringify(id, null, 2)} as const;
export const WORKER_SHA256 = IDENTITY.worker.wasm_sha256;
export const WORKER_TX = IDENTITY.worker.add_version_tx;
export const WORKER_INFO_CALL = IDENTITY.worker.info_call;
export const CONTRACT_CODE_HASH = IDENTITY.contract.code_hash;
export const CONTRACT_WASM_SHA256 = IDENTITY.contract.wasm_sha256;
export const short = (h: string) => \`\${h.slice(0, 8)}…\${h.slice(-8)}\`;
`;

const releaseSumsPath = "contracts/keys/release/SHA256SUMS";
let releaseSums = readFileSync(root + releaseSumsPath, "utf8").replace(
  /^[a-f0-9]{64}  v2\.5\/keyhole_keys\.wasm$/m,
  `${candidateSha}  v2.5/keyhole_keys.wasm`,
);
if (id.contract_candidate) {
  const c = id.contract_candidate;
  releaseSums =
    releaseSums
      .split("\n")
      .filter((x) => x && !x.endsWith("  " + c.release + "/keyhole_keys.wasm"))
      .join("\n") +
    "\n" +
    c.wasm_sha256 +
    "  " +
    c.release +
    "/keyhole_keys.wasm\n";
}
const out = {
  ...(id.contract_candidate && id.contract.version !== "2.7.0"
    ? {
        ["contracts/keys/release/" +
        id.contract_candidate.release +
        "/identity.json"]:
          JSON.stringify(id.contract_candidate, null, 2) + "\n",
      }
    : {}),
  ...(id.worker_candidate
    ? {
        "tee/worker/CANDIDATE_SHA256": id.worker_candidate.wasm_sha256 + "\n",
        "docs/evidence/worker-provisioning/candidate.json":
          JSON.stringify(id.worker_candidate, null, 2) + "\n",
      }
    : {}),
  [releaseSumsPath]: releaseSums,
  "web/lib/identity.gen.ts": ts,
  "tee/worker/DEPLOYED_SHA256": id.worker.wasm_sha256 + "\n",
  "contracts/keys/release/v2.5/identity.json":
    JSON.stringify(candidate, null, 2) + "\n",
};
for (const [p, body] of Object.entries(out)) {
  let cur = "";
  try {
    cur = readFileSync(root + p, "utf8");
  } catch {}
  if (cur !== body) {
    if (process.argv.includes("--check"))
      errs.push(`${p} is stale: run node scripts/gen-identity.mjs`);
    else {
      mkdirSync(dirname(root + p), { recursive: true });
      writeFileSync(root + p, body);
    }
  }
}

const readmePath = root + "README.md";
const START = "<!-- IDENTITY:START -->";
const END = "<!-- IDENTITY:END -->";
let readme = "";
try {
  readme = readFileSync(readmePath, "utf8");
} catch {
  errs.push("README.md is missing");
}
if (readme) {
  const repo = "https://github.com/mohamedwael201193/keyhole.git";
  const checkout = `<!-- JUDGE-CHECKOUT:START -->
\`\`\`bash
git init keyhole && cd keyhole
git remote add origin ${repo}
git fetch --depth 1 origin ${reviewRef}
git checkout --detach FETCH_HEAD
test "$(git rev-parse HEAD)" = "${reviewRef}"
\`\`\`
<!-- JUDGE-CHECKOUT:END -->`;
  const rawBase = `https://raw.githubusercontent.com/mohamedwael201193/keyhole/${reviewRef}`;
  const raw = `<!-- JUDGE-RAW:START -->
\`\`\`bash
curl -fsSL ${rawBase}/judge/0-live.sh -o keyhole-live.sh
curl -fsSL ${rawBase}/judge/receipt_proof.py -o receipt_proof.py
curl -fsSL ${rawBase}/identity.json -o identity.json
IDENTITY_JSON="$PWD/identity.json" bash keyhole-live.sh
\`\`\`
<!-- JUDGE-RAW:END -->`;
  for (const [name, body, count] of [
    ["JUDGE-CHECKOUT", checkout, 2],
    ["JUDGE-RAW", raw, 1],
  ]) {
    const pattern = new RegExp(
      `<!-- ${name}:START -->[\\s\\S]*?<!-- ${name}:END -->`,
      "g",
    );
    if ([...readme.matchAll(pattern)].length !== count)
      errs.push(`README missing ${name} blocks`);
    const next = readme.replace(pattern, () => body);
    if (next !== readme && process.argv.includes("--check"))
      errs.push(`README ${name} is stale: run node scripts/gen-identity.mjs`);
    readme = next;
  }
  const summary = `<!-- LIVE-SUMMARY:START -->
> **Live contract v${k.version.split(".").slice(0, 2).join(".")}:** deployment is FINAL on mainnet ([deployment](https://nearblocks.io/txns/${k.deploy_tx})); the historical Pledge migration remains [FINAL](https://nearblocks.io/txns/${k.migrate_pledge_tx}) and is not repeated. Worker publishing is separate; lending remains disabled at release. [Live identities and strict online verification](#live-mainnet-identities).
<!-- LIVE-SUMMARY:END -->`;
  const summaryPattern =
    /<!-- LIVE-SUMMARY:START -->[\s\S]*?<!-- LIVE-SUMMARY:END -->/;
  if (!summaryPattern.test(readme))
    errs.push("README live summary marker missing");
  else readme = readme.replace(summaryPattern, () => summary);
  const artifactSummary = `<!-- LIVE-ARTIFACT:START -->
\`${liveArtifact}\` is the live **${liveRelease}** code: **${Number(k.bytes).toLocaleString("en-US")} bytes**, SHA256 \`${k.wasm_sha256}\`. \`bash judge/1-contract.sh --strict\` checks actual finalized bytes, version and minter. [Historical v2.5 source rebuild proof](docs/evidence/worker-provisioning/r2/live-strict-rebuild-complete.log) remains labelled historical. The current checkout rebuilds the separately generated source candidate, checked by CI against [\`release/SHA256SUMS\`](contracts/keys/release/SHA256SUMS) and its identity. The pinned recipe uses rustc 1.86.0, cargo-near 0.22.0 and Binaryen 123.
<!-- LIVE-ARTIFACT:END -->`;
  const artifactPattern =
    /<!-- LIVE-ARTIFACT:START -->[\s\S]*?<!-- LIVE-ARTIFACT:END -->/;
  if (!artifactPattern.test(readme))
    errs.push("README live artifact marker missing");
  else readme = readme.replace(artifactPattern, () => artifactSummary);
  const i = readme.indexOf(START);
  const j = readme.indexOf(END);
  if (i < 0 || j < 0 || j < i) {
    errs.push(
      "README.md is missing the <!-- IDENTITY:START --> … <!-- IDENTITY:END --> block; run node scripts/gen-identity.mjs after inserting the markers",
    );
  } else {
    const next =
      readme.slice(0, i) +
      identityBlock.trimEnd() +
      readme.slice(j + END.length);
    if (next !== readFileSync(readmePath, "utf8")) {
      if (process.argv.includes("--check"))
        errs.push(
          "README.md identity block is stale: run node scripts/gen-identity.mjs",
        );
      else writeFileSync(readmePath, next);
    }
  }
}

if (errs.length) {
  console.error(errs.map((e) => "FAIL " + e).join("\n"));
  process.exit(1);
}
console.log(`OK identity worker ${w8} contract ${k8}`);
