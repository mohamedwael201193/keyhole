"use client";
import { useEffect, useState } from "react";
import { useWallet } from "./wallet";
import { recoveries, type Recovery } from "./valueRecovery";

/**
 * Whether new value operations (swap, withdraw, transfer, sale) are locked for this account. They are locked while an earlier
 * operation has no final answer (a recorded recovery row). The worker refuses them too: value_op_pending (the contract still
 * holds a pending operation), admission_unknown and replay (the journal has an unfinished one). The buttons follow the lock so
 * a click never starts a second operation. Reads only the local recovery rows lib/valueRecovery.ts keeps.
 */
export function useValueLock(): { locked: boolean; rows: Recovery[] } {
  const { accountId } = useWallet();
  const [rows, setRows] = useState<Recovery[]>([]);
  useEffect(() => {
    const read = () => { try { setRows(accountId ? recoveries(accountId) : []); } catch { setRows([]); } };
    read();
    addEventListener("storage", read);
    addEventListener("keyhole-recovery", read);
    return () => { removeEventListener("storage", read); removeEventListener("keyhole-recovery", read); };
  }, [accountId]);
  return { locked: rows.length > 0, rows };
}

export const LOCK_NOTE = "Confirming an earlier transaction. New ones wait until it's confirmed.";
/** The label every locked action button shows (with a small spinner). */
export const LOCK_LABEL = "Confirming earlier transaction…";
