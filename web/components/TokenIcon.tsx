"use client";
import { TokenMark, type TokenMarkSize } from "./TokenMark";

/**
 * Thin wrapper kept for existing callers: a TokenMark with no chain badge. New code uses components/TokenMark.tsx directly.
 * `chain` is only a symbol fallback here (when no symbol is given), as it always was.
 */
export type TokenIconSize = TokenMarkSize;

export function TokenIcon({ assetId, symbol, chain, size = 24, label, className }: {
  assetId?: string | null; symbol?: string | null; chain?: string | null; size?: TokenIconSize; label?: string; className?: string;
}) {
  return <TokenMark symbol={symbol ?? chain ?? ""} assetId={assetId} size={size} label={label} className={className} />;
}
