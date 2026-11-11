"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet, SignError } from "./wallet";
import { callWorker, type WorkerResult } from "./worker";
import type { Op } from "./nep413";
import { clearSession, inSession, loadSession } from "./session";

export type Stage = "idle" | "wallet" | "enclave" | "settling";
/** Plain words for each stage, shown on the busy button with the elapsed seconds. */
export const STAGE_TEXT: Record<Stage, string> = {
  idle: "",
  wallet: "Confirm in your wallet",
  enclave: "Enclave is checking",
  settling: "Settling on NEAR Intents",
};
const SETTLES = new Set<Op>(["swap", "exact_near_exit_v1", "withdraw"]);

/** Sign → send → result, including resume after redirect wallets. Exposes a stage and elapsed seconds. */
export function useSigned(op: Op) {
  const { sign, pending, clearPending, accountId } = useWallet();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<WorkerResult | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  /** How the last result was authorised: a live session token or a fresh wallet signature. */
  const [via, setVia] = useState<"session" | "signature" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const t0 = useRef(0);
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const id = setInterval(() => {
      const s = Math.floor((Date.now() - t0.current) / 1000);
      setElapsed(s);
      if (SETTLES.has(op) && s >= 6) setStage((x) => (x === "enclave" ? "settling" : x));
    }, 500);
    return () => clearInterval(id);
  }, [busy, op]);
  const send = useCallback(async (auth: Parameters<typeof callWorker>[1]) => {
    setBusy(true); setStage("enclave"); t0.current = t0.current || Date.now();
    try {
      const { ctx: _ctx, ...rest } = auth as Parameters<typeof callWorker>[1] & { ctx?: unknown };
      const r = await callWorker(op, rest);
      if (/^(session_|bad_session$)/.test(r.error?.code || "")) clearSession();
      setRes(r);
    } catch { setRes({ call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: { code: "network" } }); }
    finally { setBusy(false); setStage("idle"); t0.current = 0; }
  }, [op]);
  useEffect(() => {
    if (pending) { try { if (JSON.parse(pending.message).op === op) { clearPending(); setVia("signature"); void send(pending); } } catch { /* ignore */ } }
  }, [pending, op, send, clearPending]);
  const clear = useCallback(() => { setRes((prev) => (prev?.error ? null : prev)); }, []);
  const reset = useCallback(() => { setRes(null); }, []);
  const run = useCallback(async (params?: Record<string, unknown>, opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setRes(null);
    setBusy(true); t0.current = Date.now();
    const viaSession = !!(inSession(op) && loadSession(accountId));
    setStage(viaSession ? "enclave" : "wallet"); setVia(viaSession ? "session" : "signature");
    try { const auth = await sign(op, params); await send(auth); }
    catch (e) {
      setBusy(false); setStage("idle"); t0.current = 0;
      if (opts?.quiet) return;
      setRes({ call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: { code: e instanceof SignError ? e.code : "wallet_rejected" } });
    }
  }, [sign, op, send, accountId]);
  return { run, busy, res, via, clear, reset, stage, elapsed, label: busy ? `${STAGE_TEXT[stage]}… ${elapsed}s` : "" };
}
