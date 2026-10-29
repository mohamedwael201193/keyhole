"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet, SignError } from "./wallet";
import { callWorker, type WorkerResult } from "./worker";
import type { Op } from "./nep413";

/** Sign → send → result, including resume after redirect wallets. */
export function useSigned(op: Op) {
  const { sign, pending, clearPending } = useWallet();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<WorkerResult | null>(null);
  const send = useCallback(async (auth: Parameters<typeof callWorker>[1]) => {
    setBusy(true);
    try {
      const { ctx: _ctx, ...rest } = auth as Parameters<typeof callWorker>[1] & { ctx?: unknown };
      setRes(await callWorker(op, rest));
    } catch { setRes({ call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: { code: "network" } }); }
    finally { setBusy(false); }
  }, [op]);
  useEffect(() => {
    if (pending) { try { if (JSON.parse(pending.message).op === op) { clearPending(); void send(pending); } } catch { /* ignore */ } }
  }, [pending, op, send, clearPending]);
  const clear = useCallback(() => { setRes((prev) => (prev?.error ? null : prev)); }, []);
  const reset = useCallback(() => { setRes(null); }, []);
  const run = useCallback(async (params?: Record<string, unknown>, opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setRes(null);
    setBusy(true);
    try { const auth = await sign(op, params); await send(auth); }
    catch (e) {
      setBusy(false);
      if (opts?.quiet) return;
      setRes({ call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: { code: e instanceof SignError ? e.code : "wallet_rejected" } });
    }
  }, [sign, op, send]);
  return { run, busy, res, clear, reset };
}
