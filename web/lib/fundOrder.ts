import { isTerminalStatus } from "./oneclick";

/**
 * The active "fund from another chain" order, kept per account and holder key so the Deposit sheet and the vault page can show
 * it again. Only what the quote and the status route returned is stored. localStorage is per browser: a private window, a
 * cleared profile or a blocked store simply means no saved order, and every read and write is guarded.
 */
export type SavedOrder = {
  account: string;
  tokenId: string;
  depositAddress: string;
  depositMemo: string | null;
  originSymbol: string;
  originChain: string;
  /** Amount to send, formatted by 1Click (origin token). */
  amountIn: string | null;
  destSymbol: string;
  /** Amount the vault receives, formatted (destination token). */
  amountOut: string | null;
  /** Quote deadline, ISO. */
  deadline: string | null;
  timeWhenInactive: string | null;
  /** Epoch ms, set when the quote was created. */
  createdAt: number;
};

export type OrderStatus = { status?: string; updatedAt?: string };

/** An order's window: the quote deadline (or 30 minutes after creation when there is none), plus one hour. */
export const ORDER_GRACE_MS = 60 * 60_000;
export function orderWindowEnd(o: Pick<SavedOrder, "deadline" | "createdAt">): number {
  const d = o.deadline ? Date.parse(o.deadline) : NaN;
  return (Number.isFinite(d) ? d : o.createdAt + 30 * 60_000) + ORDER_GRACE_MS;
}

/** Shown while the window is open, or while the last known status is not terminal (a deposit may still be moving). */
export function isOrderVisible(o: SavedOrder, status: string | null | undefined, now: number): boolean {
  if (now <= orderWindowEnd(o)) return true;
  return !!status && !isTerminalStatus(status);
}

export const orderKey = (account: string, tokenId: string) => `kh.fundOrder:${account}:${tokenId}`;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** The browser store, or null when it cannot be reached (server render, blocked storage). */
function browserStore(): Store | null {
  try { return typeof window !== "undefined" && window.localStorage ? window.localStorage : null; } catch { return null; }
}

const str = (v: unknown): v is string => typeof v === "string";
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";

/** A stored value, checked field by field. Anything unexpected is dropped. */
export function parseOrder(raw: unknown): SavedOrder | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!str(r.account) || !str(r.tokenId) || !str(r.depositAddress) || !str(r.originSymbol) || !str(r.originChain) || !str(r.destSymbol)) return null;
  if (typeof r.createdAt !== "number" || !Number.isFinite(r.createdAt)) return null;
  if (!strOrNull(r.depositMemo) || !strOrNull(r.amountIn) || !strOrNull(r.amountOut) || !strOrNull(r.deadline) || !strOrNull(r.timeWhenInactive)) return null;
  return {
    account: r.account, tokenId: r.tokenId, depositAddress: r.depositAddress, depositMemo: r.depositMemo, originSymbol: r.originSymbol,
    originChain: r.originChain, amountIn: r.amountIn, destSymbol: r.destSymbol, amountOut: r.amountOut, deadline: r.deadline,
    timeWhenInactive: r.timeWhenInactive, createdAt: r.createdAt,
  };
}

/** The saved order for this account and key. Null when none, when the store fails, or when the payload belongs to another key. */
export function readOrder(account: string, tokenId: string, store: Store | null = browserStore()): SavedOrder | null {
  try {
    const raw = store?.getItem(orderKey(account, tokenId));
    if (!raw) return null;
    const o = parseOrder(JSON.parse(raw));
    return o && o.account === account && o.tokenId === tokenId ? o : null;
  } catch { return null; }
}

/** Saves the order. Returns false when the store refused (the order still shows for this page visit). */
export function writeOrder(o: SavedOrder, store: Store | null = browserStore()): boolean {
  try { store?.setItem(orderKey(o.account, o.tokenId), JSON.stringify(o)); return !!store; } catch { return false; }
}

export function removeOrder(account: string, tokenId: string, store: Store | null = browserStore()): void {
  try { store?.removeItem(orderKey(account, tokenId)); } catch { /* storage unavailable: nothing to clear */ }
}
