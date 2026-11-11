"use client";
import { useCallback, useEffect, useState } from "react";
import { createPledgeClient, type CollateralBinding, type Loan, type PledgeConfig } from "@/lib/pledgeClient";
import { requestLoanCertificate, verifyLoanCertificate } from "@/lib/loanCertificate";
import type { LienControl } from "@/lib/lien";

/** Read-only lien views. `live: true` reads the chain even while the Pledge flag is off; it never signs or sends. */
const client = createPledgeClient({ live: true });
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

export function useLien(tokenId: string | null) {
  const [st, setSt] = useState<LienRead>(EMPTY);
  const [round, setRound] = useState(0);
  const [cert, setCert] = useState<CertCheck>({ status: "idle", message: null });

  useEffect(() => {
    if (!tokenId || !KEY_ID_RE.test(tokenId)) { setSt(EMPTY); setCert({ status: "idle", message: null }); return; }
    let live = true;
    setSt({ ...EMPTY, status: "loading", tokenId });
    setCert({ status: "idle", message: null });
    (async () => {
      try {
        const [owner, control, loan, binding, config] = await Promise.all([
          client.getOwner(tokenId),
          client.getControl(tokenId),
          client.getLoan(tokenId),
          client.getCollateralBinding(tokenId),
          client.getPledgeConfig(),
        ]);
        if (!live) return;
        if (!owner) { setSt({ ...EMPTY, status: "error", tokenId, error: "No key with this id on the KEYHOLE contract." }); return; }
        setSt({ status: "ready", tokenId, owner, control: control as LienControl | null, loan, binding, config, error: null });
      } catch {
        if (live) setSt({ ...EMPTY, status: "error", tokenId, error: "Could not read the final chain. Try again in a moment." });
      }
    })();
    return () => { live = false; };
  }, [tokenId, round]);

  const refresh = useCallback(() => setRound((n) => n + 1), []);

  /**
   * Checks an Offered loan's certificate in this browser. Explicit user action only: it asks the enclave for the
   * certificate (rate limited) and verifies its signature against the expected terms read from the chain.
   */
  const verifyCertificate = useCallback(async () => {
    const loan = st.loan;
    if (!loan || !st.tokenId || !st.config) return;
    setCert({ status: "checking", message: null });
    try {
      const bundle = await requestLoanCertificate(st.tokenId, loan.nonce);
      const expected = await client.getCertificateTemplate(st.tokenId, bundle.certificate.observed_at_ns, bundle.certificate.expires_at_ns);
      if (!expected) { setCert({ status: "unavailable", message: "The contract returned no certificate template for this loan." }); return; }
      const nowNs = await client.chainNowNs();
      const ok = await verifyLoanCertificate(bundle, expected, st.config, nowNs);
      setCert(ok
        ? { status: "valid", message: "Certificate signature and terms check out against the final chain." }
        : { status: "invalid", message: "Certificate did not verify. Do not rely on this offer." });
    } catch (e) {
      setCert({ status: "unavailable", message: e instanceof Error ? e.message : "Sealed certificate unavailable. Declared floor is not verified." });
    }
  }, [st.loan, st.tokenId, st.config]);

  return { ...st, refresh, cert, verifyCertificate };
}
export type UseLien = ReturnType<typeof useLien>;
