"use client";
import { useCallback, useEffect, useState } from "react";
import { probeSaleSupport, type SaleSupport } from "./sale";

/**
 * Feature detection for the key sale. One read of nft_listings (limit 1) per page load: "open" when the contract has the
 * sale methods, "v23" when the RPC says the method does not exist (the deployed contract predates v2.4). A failed read is
 * "unknown" and is retried on the next visit, never shown as "v23".
 */
let known: SaleSupport | null = null;
let inflight: Promise<SaleSupport> | null = null;

function probeOnce(): Promise<SaleSupport> {
  if (!inflight) {
    inflight = probeSaleSupport()
      .then((s) => { if (s !== "unknown") known = s; return s; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function useSaleSupport(): { support: SaleSupport; retry: () => void } {
  const [support, setSupport] = useState<SaleSupport>(known ?? "checking");
  const run = useCallback(() => {
    if (known) { setSupport(known); return; }
    setSupport("checking");
    void probeOnce().then(setSupport);
  }, []);
  useEffect(() => { run(); }, [run]);
  return { support, retry: run };
}
