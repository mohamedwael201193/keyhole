import { TRIAL_CONTRACT } from "./trialPublic";

export const REFUSAL_ERROR = "Sender not approved";
export const REFUSAL_RECEIVER = "kh000000000000.testnet";

export type RefusalExpect = {
  signer: string;
  tokenId: string;
  receiverId: string;
  contract?: string;
};

type Action = {
  FunctionCall?: { method_name?: string; args?: string };
  method_name?: string;
  args?: string;
};

/**
 * Green "Old holder refused" only for a FINAL nft_transfer on the pinned contract,
 * signed by the old holder, for this token and the practice receiver, whose panic is exactly
 * "Sender not approved". Every other receipt is unknown.
 * https://docs.near.org/api/rpc/transactions#transaction-status-with-receipts
 */
/** A successful FINAL transfer of this token to this receiver, signed by the old holder. */
export function transferLanded(tx: unknown, expect: RefusalExpect): boolean {
  if (!tx || typeof tx !== "object") return false;
  const row = tx as { final_execution_status?: string; status?: { SuccessValue?: string }; transaction?: { signer_id?: string; receiver_id?: string; actions?: Action[] } };
  if (row.final_execution_status !== "FINAL") return false;
  if (!row.status || !("SuccessValue" in row.status)) return false;
  const transaction = row.transaction;
  if (!transaction || transaction.signer_id !== expect.signer || transaction.receiver_id !== (expect.contract ?? TRIAL_CONTRACT)) return false;
  const call = (transaction.actions ?? []).map(functionCall).filter((x): x is { method: string; args: string } => !!x);
  if (call.length !== 1 || call[0].method !== "nft_transfer") return false;
  const args = decodeArgs(call[0].args);
  return !!args && args.token_id === expect.tokenId && args.receiver_id === expect.receiverId;
}

export function classifyRefusal(tx: unknown, expect: RefusalExpect): "refused" | "unknown" {
  if (!tx || typeof tx !== "object") return "unknown";
  const row = tx as {
    final_execution_status?: string;
    status?: unknown;
    transaction?: { signer_id?: string; receiver_id?: string; actions?: Action[] };
    receipts_outcome?: { outcome?: { executor_id?: string; status?: unknown } }[];
  };
  if (row.final_execution_status !== "FINAL") return "unknown";
  const transaction = row.transaction;
  if (!transaction) return "unknown";
  if (transaction.signer_id !== expect.signer) return "unknown";
  if (transaction.receiver_id !== (expect.contract ?? TRIAL_CONTRACT)) return "unknown";
  const call = (transaction.actions ?? []).map(functionCall).filter((x): x is { method: string; args: string } => !!x);
  if (call.length !== 1 || call[0].method !== "nft_transfer") return "unknown";
  const args = decodeArgs(call[0].args);
  if (!args || args.token_id !== expect.tokenId || args.receiver_id !== expect.receiverId) return "unknown";
  const top = panicText(row.status);
  if (top !== REFUSAL_ERROR) return "unknown";
  const receipts = row.receipts_outcome ?? [];
  const onContract = receipts.filter((r) => r.outcome?.executor_id === (expect.contract ?? TRIAL_CONTRACT));
  if (onContract.length !== 1 || panicText(onContract[0].outcome?.status) !== REFUSAL_ERROR) return "unknown";
  return "refused";
}

function functionCall(action: Action): { method: string; args: string } | null {
  const fn = action.FunctionCall;
  const method = fn?.method_name ?? action.method_name;
  const args = fn?.args ?? action.args;
  if (!method || typeof args !== "string") return null;
  return { method, args };
}

function decodeArgs(args: string): { token_id?: string; receiver_id?: string } | null {
  try {
    const json = Buffer.from(args, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { token_id?: unknown; receiver_id?: unknown };
    if (typeof parsed.token_id !== "string" || typeof parsed.receiver_id !== "string") return null;
    return { token_id: parsed.token_id, receiver_id: parsed.receiver_id };
  } catch {
    return null;
  }
}

function panicText(status: unknown): string | null {
  const text = JSON.stringify(status ?? null);
  const quoted = text.match(/ExecutionError":"((?:\\.|[^"\\])*)"/);
  if (!quoted) return null;
  const plain = quoted[1].replace(/\\"/g, "\"").replace(/\\n/g, " ");
  const panic = plain.match(/panicked:\s*(.*)$/);
  const message = (panic?.[1] ?? plain).trim().replace(/[.\s]+$/, "");
  return message;
}
