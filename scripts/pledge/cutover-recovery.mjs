import { restoreProbe, attested } from "../release/gates.mjs";
import { context } from "../release/promote-v26.mjs";
// Read-only classifier, NOT an executor or a substitute for original receipt proof.
export async function cutoverNext(plan, s, options = {}) {
  const stop = (why) => ({ next: "STOP", maintenance: true, why });
  if (!s.maintenance_enforced || !s.old_jobs_drained)
    return stop(
      "enforce and exercise admission barrier; drain every direct submitter",
    );
  if (s.unresolved_original)
    return stop("reconcile original hash only; never resend UNKNOWN");
  if (s.uuid !== "p000000000000004b") return stop("storage namespace changed");
  const old = plan.retired;
  if (!old.includes(plan.previous_active))
    return stop("missing reviewed original active version");
  const states = [
    old,
    [plan.hash, ...old.slice(4)],
    [plan.hash, ...old.slice(13)],
    [plan.hash],
  ];
  const i = states.findIndex(
    (xs) =>
      xs.length === s.versions.length &&
      new Set(s.versions).size === xs.length &&
      xs.every((x) => s.versions.includes(x)),
  );
  if (
    i < 0 ||
    (i > 0 && s.active !== plan.hash) ||
    (i === 0 && s.active !== plan.previous_active)
  )
    return stop("unexpected/non-atomic registry; do not improvise rollback");
  if (!s.upload_verified)
    return i === 0
      ? { next: "verify_or_finish_original_upload", maintenance: true }
      : stop("active candidate upload unverified");
  if (s.secret_hash !== plan.hash)
    return i === 0
      ? {
          next: "merge_secrets_once_after_original_terminal_gate",
          maintenance: true,
        }
      : stop("active candidate secret mismatch");
  if (i < 3) return { next: `registry_batch_${i + 1}`, maintenance: true };
  if (
    s.runtime?.attested_hash !== plan.hash ||
    !s.runtime?.minter_attestor_continuity ||
    !s.runtime?.frontend_compatible ||
    !s.runtime?.lending_disabled
  )
    return { next: "verify_restore_service", maintenance: true };
  try {
    const ctx = await (options.context || context)({
      restore: s.runtime.probe,
    });
    await restoreProbe(s.runtime.probe, ctx);
    if (
      ctx.registry.active_version !== plan.hash ||
      ctx.registry.uuid !== s.uuid ||
      ctx.snapshot?.pledge.lending_enabled !== false
    )
      throw Error("live restore context mismatch");
    await attested(s.runtime.info, "info", ctx);
    if (
      s.runtime.info.output.minter_account !== ctx.snapshot.config.minter ||
      Buffer.from(ctx.snapshot.pledge.attestor_public_key, "base64").toString(
        "hex",
      ) !== ctx.snapshot.config.minter
    )
      throw Error("authority continuity not proved");
  } catch {
    return { next: "verify_restore_service", maintenance: true };
  }
  return { next: "reopen_admission", maintenance: false };
}
