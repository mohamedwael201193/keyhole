"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet, SignError } from "./wallet";
import { callWorker, type WorkerResult } from "./worker";
import type { Op } from "./nep413";
import { clearSession, inSession, loadSession } from "./session";
import { vaultCacheGet, vaultCacheSet } from "./vaultCache";

export type Stage = "idle" | "wallet" | "enclave" | "settling";
/** Plain words for each stage, shown on the busy button with the elapsed seconds. */
export const STAGE_TEXT: Record<Stage, string> = {
  idle: "",
  wallet: "Confirm in your wallet",
  enclave: "Enclave is checking",
  settling: "Settling on NEAR Intents",
};
const SETTLES = new Set<Op>(["swap", "exact_near_exit_v1", "withdraw"]);

/**
 * Sign → send → result, including resume after redirect wallets. Exposes a stage and elapsed seconds.
 *
 * Reads can be cached: pass `cacheKey` (from lib/vaultCache, keyed by account + session + op) and `cached: true`
 * on run(). A fresh cached entry is served without signing or calling the worker, so tab navigation never re-reads
 * the vault; a miss runs the signed read and stores it. `fresh: true` skips the serve (explicit refresh) but still
 * stores the new answer. Mutations never pass `cached`, so they are never served or stored — and every mutation
 * invalidates what it changed before re-reading (see the callers).
 */
export function useSigned(op: Op, opts?: { cacheKey?: string | null }) {
  const { sign, pending, clearPending, accountId } = useWallet();
  const cacheKey = opts?.cacheKey ?? null;
  const [busy, setBusy] = useState(false);
  /** A cached read seeds the first paint, so a return visit shows the last answer at once. */
  const [res, setRes] = useState<WorkerResult | null>(() => vaultCacheGet(cacheKey));
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
  const send = useCallback(async (auth: Parameters<typeof callWorker>[1]): Promise<WorkerResult | null> => {
    setBusy(true); setStage("enclave"); t0.current = t0.current || Date.now();
    try {
      const { ctx: _ctx, ...rest } = auth as Parameters<typeof callWorker>[1] & { ctx?: unknown };
      const r = await callWorker(op, rest);
      if (/^(session_|bad_session$)/.test(r.error?.code || "")) clearSession();
      setRes(r);
      return r;
    } catch {
      const r: WorkerResult = { call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: { code: "network" } };
      setRes(r);
      return r;
    }
    finally { setBusy(false); setStage("idle"); t0.current = 0; }
  }, [op]);
  useEffect(() => {
    if (pending) { try { if (JSON.parse(pending.message).op === op) { clearPending(); setVia("signature"); void send(pending); } } catch { /* ignore */ } }
  }, [pending, op, send, clearPending]);
  const clear = useCallback(() => { setRes((prev) => (prev?.error ? null : prev)); }, []);
  const reset = useCallback(() => { setRes(null); }, []);
  const run = useCallback(async (params?: Record<string, unknown>, opts?: { quiet?: boolean; cached?: boolean; fresh?: boolean }) => {
    // A fresh cached answer is served without signing: this is what stops the re-read on every tab navigation.
    if (opts?.cached && cacheKey && !opts?.fresh) {
      const hit = vaultCacheGet(cacheKey);
      if (hit) {
        if (inSession(op) && loadSession(accountId)) setVia("session");
        setRes(hit);
        return;
      }
    }
    if (!opts?.quiet) setRes(null);
    setBusy(true); t0.current = Date.now();
    const viaSession = !!(inSession(op) && loadSession(accountId));
    setStage(viaSession ? "enclave" : "wallet"); setVia(viaSession ? "session" : "signature");
    try {
      const auth = await sign(op, params);
      const r = await send(auth);
      if (opts?.cached && cacheKey && r?.output?.ok) vaultCacheSet(cacheKey, r);
    }
    catch (e) {
      setBusy(false); setStage("idle"); t0.current = 0;
      if (opts?.quiet) return;
      setRes({ call_id: null, status: null, output: null, attestation_url: null, time_ms: null, error: { code: e instanceof SignError ? e.code : "wallet_rejected" } });
    }
  }, [sign, op, send, accountId, cacheKey]);
  return { run, busy, res, via, clear, reset, stage, elapsed, label: busy ? `${STAGE_TEXT[stage]}… ${elapsed}s` : "" };
}
