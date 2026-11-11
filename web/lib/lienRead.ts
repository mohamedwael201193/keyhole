/** Cache identity for a lien read. A later response may update the panel only when this key is still current. */

export function lienCacheKey(parts: { contract: string; tokenId: string; owner: string | null; marker: string }): string {
  return `${parts.contract}\n${parts.tokenId}\n${parts.owner ?? ""}\n${parts.marker}`;
}

export function lienReadCurrent(
  started: { tokenId: string; generation: number },
  current: { tokenId: string | null; generation: number },
  aborted: boolean,
): boolean {
  return !aborted && current.generation === started.generation && current.tokenId === started.tokenId;
}

/** A certificate result is for the key that requested it. A newer key, or an aborted request, does not become "valid". */
export function certificateCurrent(
  started: { tokenId: string; generation: number },
  current: { tokenId: string | null; generation: number },
  aborted: boolean,
  certificateTokenId: string | null,
): boolean {
  return lienReadCurrent(started, current, aborted) && certificateTokenId === started.tokenId;
}

/** One view plus the block the node says it executed on. */
export type PinnedView = { value: unknown; blockHeight: number; blockHash: string };

export type LienControlFields = {
  token_id: string;
  owner_epoch: string;
  pending_value_ops: string;
  listed: boolean;
  transfer_pending: boolean;
  pledged: boolean;
  value_op_nonce: string;
};

export type LienSnapshot =
  | { ok: false; reason: string }
  | { ok: true; missing: true }
  | { ok: true; missing: false; owner: string; control: LienControlFields; loan: unknown; binding: unknown; config: unknown };

/** Kept off the panel. The read is discarded and tried once more against a new final block. */
export const LIEN_BLOCK_MISMATCH = "The lien reads did not land on one finalized block. Try again in a moment.";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const U64_MAX = (1n << 64n) - 1n;

function u64(v: unknown): string | null {
  if (typeof v === "string" && /^\d+$/.test(v)) {
    const n = BigInt(v);
    return n <= U64_MAX ? n.toString() : null;
  }
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return String(v);
  return null;
}

function u64n(v: unknown): bigint | null {
  const s = u64(v);
  return s === null ? null : BigInt(s);
}

/**
 * Loan / owner / epoch combinations one block can actually hold.
 * pledged is true exactly when a loan record exists (lib.rs get_control_state).
 *
 * While a loan exists, assert_token_idle (pledge.rs:423-427) refuses every ordinary transfer, so the
 * current owner epoch stays on the epoch copied at open (pledge.rs:451-453) except for one path.
 *
 * - Freezing, Offered, DisbursementPending, Active: owner is the borrower and control epoch equals
 *   loan.owner_epoch. fund_loan rechecks both (pledge.rs:537-538). resolution is still unset.
 * - UnlockPending / repaid: repay_loan (pledge.rs:561-568) does not transfer. Same owner, same epoch.
 * - UnlockPending / canceled: cancel_loan (pledge.rs:572-577) does not transfer. Same owner, same epoch.
 * - UnlockPending / default_claimed: claim_default (pledge.rs:581-593) calls transfer_key_unlocked
 *   (lib.rs:438-455), which bumps the owner epoch once, then stores the same loan. The loan keeps its
 *   opening epoch. The new owner is not the borrower. Thaw later deletes the loan (pledge.rs:510-513).
 * - No loan: the record is gone. Any current owner and epoch are the chain's, and pledged is false.
 */
function loanBindingHolds(loan: Record<string, unknown>, ownerId: string, controlEpoch: bigint): boolean {
  const state = loan.state;
  const loanEpoch = u64n(loan.owner_epoch);
  const borrower = loan.borrower;
  if (typeof state !== "string" || loanEpoch === null || typeof borrower !== "string" || borrower.length === 0) return false;
  const resolution = loan.resolution;
  const sameTitle = ownerId === borrower && loanEpoch === controlEpoch;
  if (state === "Freezing" || state === "Offered" || state === "DisbursementPending" || state === "Active") {
    return (resolution === null || resolution === undefined) && sameTitle;
  }
  if (state !== "UnlockPending") return false;
  if (resolution === "repaid" || resolution === "canceled") return sameTitle;
  if (resolution === "default_claimed") return ownerId !== borrower && controlEpoch === loanEpoch + 1n;
  return false;
}

function onBlock(view: PinnedView, block: { height: number; hash: string }): boolean {
  return view.blockHeight === block.height && view.blockHash === block.hash && block.hash.length > 0;
}

/**
 * Accept a lien snapshot only when every view executed on the same finalized block and the fields that must
 * move together still agree. A sale between reads (old owner, new epoch) fails the block check. A loan is
 * kept only when its state, epoch, and owner match the contract. A post-default UnlockPending loan keeps
 * its opening epoch while the key epoch is one higher. Anything else is discarded.
 */
export function lienSnapshotFromViews(input: {
  tokenId: string;
  block: { height: number; hash: string };
  owner: PinnedView;
  control: PinnedView;
  loan: PinnedView;
  binding: PinnedView;
  config: PinnedView;
}): LienSnapshot {
  const views = [input.owner, input.control, input.loan, input.binding, input.config];
  if (views.some((view) => !onBlock(view, input.block))) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  const ownerValue = input.owner.value;
  const ownerId = ownerValue === null ? null : isRecord(ownerValue) && typeof ownerValue.owner_id === "string" ? ownerValue.owner_id : undefined;
  if (ownerId === undefined || ownerId === "") return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  if (ownerId === null) {
    if (input.control.value !== null || input.loan.value !== null) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
    return { ok: true, missing: true };
  }
  const control = input.control.value;
  if (!isRecord(control)) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  const ownerEpoch = u64(control.owner_epoch);
  const controlEpoch = u64n(control.owner_epoch);
  const pending = u64(control.pending_value_ops);
  const nonce = u64(control.value_op_nonce);
  if (control.token_id !== input.tokenId || ownerEpoch === null || controlEpoch === null || pending === null || nonce === null) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  if (typeof control.listed !== "boolean" || typeof control.transfer_pending !== "boolean" || typeof control.pledged !== "boolean") {
    return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  }
  const loan = input.loan.value;
  if (loan !== null) {
    if (!isRecord(loan) || loan.token_id !== input.tokenId) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
    if (!loanBindingHolds(loan, ownerId, controlEpoch)) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  }
  if (control.pledged !== (loan !== null)) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  if (input.binding.value !== null && !isRecord(input.binding.value)) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  if (input.config.value !== null && !isRecord(input.config.value)) return { ok: false, reason: LIEN_BLOCK_MISMATCH };
  return {
    ok: true,
    missing: false,
    owner: ownerId,
    control: {
      token_id: input.tokenId,
      owner_epoch: ownerEpoch,
      pending_value_ops: pending,
      listed: control.listed,
      transfer_pending: control.transfer_pending,
      pledged: control.pledged,
      value_op_nonce: nonce,
    },
    loan,
    binding: input.binding.value,
    config: input.config.value,
  };
}

/** What the panel is allowed to render. A mismatch is an error with no owner and no epoch, so it cannot read "Not locked". */
export function applyLienSnapshot(tokenId: string, read: LienSnapshot): {
  status: "ready" | "error";
  tokenId: string;
  owner: string | null;
  control: LienControlFields | null;
  loan: unknown;
  binding: unknown;
  config: unknown;
  error: string | null;
} {
  if (!read.ok) return { status: "error", tokenId, owner: null, control: null, loan: null, binding: null, config: null, error: read.reason };
  if (read.missing) {
    return { status: "error", tokenId, owner: null, control: null, loan: null, binding: null, config: null, error: "No key with this id on the KEYHOLE contract." };
  }
  return { status: "ready", tokenId, owner: read.owner, control: read.control, loan: read.loan, binding: read.binding, config: read.config, error: null };
}
