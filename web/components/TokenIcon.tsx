"use client";
import { useState } from "react";
import { monogram, tokenIcon } from "@/lib/tokenIcons";

/**
 * A token mark: a plain circle at 20, 24 or 32 px (default 24). The official mark from /tokens when one is mapped, otherwise
 * a neutral monogram chip. No brass ring or medallion. Styles: app/ui.css (.kh-tkicon).
 * Pass `label` only when the icon stands alone; beside its symbol text it stays decorative (alt="").
 */
export type TokenIconSize = 20 | 24 | 32;

export function TokenIcon({ assetId, symbol, chain, size = 24, label, className }: {
  assetId?: string | null; symbol?: string | null; chain?: string | null; size?: TokenIconSize; label?: string; className?: string;
}) {
  const icon = tokenIcon({ assetId, symbol, chain });
  const [failed, setFailed] = useState(false);
  const wrap = ["kh-tkicon", `kh-tkicon--${size}`, className].filter(Boolean).join(" ");

  if (!icon || failed) {
    return (
      <span className={wrap} data-icon="monogram" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        <span className="tkicon-mono" data-size={size}>{monogram(symbol ?? chain)}</span>
      </span>
    );
  }
  return (
    <span className={wrap} data-icon={icon.key} aria-hidden={label ? undefined : true}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={icon.src} alt={label ?? ""} data-logo={icon.key} width={size} height={size} onError={() => setFailed(true)} />
    </span>
  );
}
