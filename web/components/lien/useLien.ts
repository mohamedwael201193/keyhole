"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPledgeClient, type CollateralBinding, type Loan, type PledgeConfig } from "@/lib/pledgeClient";
import { requestLoanCertificate, verifyLoanCertificate } from "@/lib/loanCertificate";
import type { LienControl } from "@/lib/lien";
import { certificateCurrent, lienCacheKey, lienReadCurrent } from "@/lib/lienRead";

/** Read-only lien views. `live: true` reads the chain even while the Pledge flag is off; it never signs or sends. */
export const KEY_ID_RE = /^(k[0-9a-f]{16}|\d{1,9})$/;

export type LienRead = {
  status: "idle" | "loading" | "ready" | "error";
  tokenId: string;
  owner: string | null;
  control: LienControl | null;
  loan: Loan | null;
  binding: CollateralBinding | null;
  config: PledgeConfig | null;
  error: string | null;
};
export type CertCheck = { status: "idle" | "checking" | "valid" | "invalid" | "unavailable"; message: string | null };

const EMPTY: LienRead = { status: "idle", tokenId: "", owner: null, control: null, loan: null, binding: null, config: null, error: null };

export type LienScope = {
  /** Current nft_token owner. A change misses the previous cache entry. */
  owner?: string | null;
  /** Caller-supplied freshness: sale round, or a repeat lookup of the same key id. */
  marker?: string | number;
};

export function useLien(tokenId: string | null, scope: LienScope = {}) {
  const owner = scope.owner ?? null;
  const marker = String(scope.marker ?? "");
  const [round, setRound] = useState(0);
  const [st, setSt] = useState<LienRead>(EMPTY);
  const [cert, setCert] = useState<CertCheck>({ status: "idle", message: null });
  const generation = useRef(0);
  const tokenRef = useRef(tokenId);
  const certAbort = useRef<AbortController | null>(null);
  const contractId = createPledgeClient({ live: true }).contractId;
  const key = tokenId && KEY_ID_RE.test(tokenId)
    ? lienCacheKey({ contract: contractId, tokenId, owner, marker: `${marker}:${round}` })
    : "";

  useEffect(() => {
    tokenRef.current = tokenId;
    const gen = ++generation.current;
    certAbort.current?.abort();
    certAbort.current = null;
    if (!tokenId || !KEY_ID_RE.test(tokenId)) { setSt(EMPTY); setCert({ status: "idle", message: null }); return; }
    const started = { tokenId, generation: gen };
    const ctrl = new AbortController();
    setSt({ ...EMPTY, status: "loading", tokenId });
    setCert({ status: "idle", message: null });
    const reader = createPledgeClient({ live: true, signal: ctrl.signal });
    void (async () => {
      try {
        const [readOwner, control, loan, binding, config] = await Promise.all([
          reader.getOwner(tokenId),
          reader.getControl(tokenId),
          reader.getLoan(tokenId),
          reader.getCollateralBinding(tokenId),
          reader.getPledgeConfig(),
        ]);
        if (!lienReadCurrent(started, { tokenId: tokenRef.current, generation: generation.current }, ctrl.signal.aborted)) return;
        if (!readOwner) { setSt({ ...EMPTY, status: "error", tokenId, error: "No key with this id on the KEYHOLE contract." }); return; }
        setSt({ status: "ready", tokenId, owner: readOwner, control: control as LienControl | null, loan, binding, config, error: null });
      } catch {
        if (!lienReadCurrent(started, { tokenId: tokenRef.current, generation: generation.current }, ctrl.signal.aborted)) return;
        setSt({ ...EMPTY, status: "error", tokenId, error: "Could not read the final chain. Try again in a moment." });
      }
    })();
    return () => ctrl.abort();
  }, [key, tokenId]);

  const refresh = useCallback(() => setRound((n) => n + 1), []);

  /**
   * Checks an Offered loan's certificate in this browser. Explicit user action only: it asks the enclave for the
   * certificate (a network request, not an on-chain transaction) and verifies its signature against the chain.
   * A response that belongs to an earlier key is dropped.
   */
  const verifyCertificate = useCallback(async () => {
    const loan = st.loan;
    const token = st.tokenId;
    const config = st.config;
    if (!loan || !token || !config) return;
    const started = { tokenId: token, generation: generation.current };
    certAbort.current?.abort();
    const ctrl = new AbortController();
    certAbort.current = ctrl;
    setCert({ status: "checking", message: null });
    try {
      const reader = createPledgeClient({ live: true, signal: ctrl.signal });
      const bundle = await requestLoanCertificate(token, loan.nonce, ctrl.signal);
      const still = () => lienReadCurrent(started, { tokenId: tokenRef.current, generation: generation.current }, ctrl.signal.aborted);
      if (!still()) return;
      if (bundle.certificate.token_id !== token) {
        setCert({ status: "invalid", message: "Certificate is for another key. Do not rely on this offer." });
        return;
      }
      const expected = await reader.getCertificateTemplate(token, bundle.certificate.observed_at_ns, bundle.certificate.expires_at_ns);
      if (!certificateCurrent(started, { tokenId: tokenRef.current, generation: generation.current }, ctrl.signal.aborted, bundle.certificate.token_id)) return;
      if (!expected) { setCert({ status: "unavailable", message: "The contract returned no certificate template for this loan." }); return; }
      const nowNs = await reader.chainNowNs();
      if (!certificateCurrent(started, { tokenId: tokenRef.current, generation: generation.current }, ctrl.signal.aborted, bundle.certificate.token_id)) return;
      const ok = await verifyLoanCertificate(bundle, expected, config, nowNs);
      if (!certificateCurrent(started, { tokenId: tokenRef.current, generation: generation.current }, ctrl.signal.aborted, bundle.certificate.token_id)) return;
      setCert(ok
        ? { status: "valid", message: "Certificate signature and terms check out against the final chain." }
        : { status: "invalid", message: "Certificate did not verify. Do not rely on this offer." });
    } catch (e) {
      if (ctrl.signal.aborted || !certificateCurrent(started, { tokenId: tokenRef.current, generation: generation.current }, false, token)) return;
      setCert({ status: "unavailable", message: e instanceof Error ? e.message : "Sealed certificate unavailable. Declared floor is not verified." });
    }
  }, [st.loan, st.tokenId, st.config]);

  return { ...st, refresh, cert, verifyCertificate };
}
export type UseLien = ReturnType<typeof useLien>;
