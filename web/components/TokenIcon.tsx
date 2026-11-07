"use client";
import { useState } from "react";
import { monogram, tokenIcon } from "@/lib/tokenIcons";

/**
 * Official mark inside the brass medallion (.medal). Falls back to a monogram when the asset has no mark, or the file fails to load.
 * Pass `label` only when the icon stands alone; beside its symbol text it stays decorative (alt="").
 */
export function TokenIcon({ assetId, symbol, chain, size = "md", label, className }: {
  assetId?: string | null; symbol?: string | null; chain?: string | null; size?: "sm" | "md" | "lg"; label?: string; className?: string;
}) {
  const icon = tokenIcon({ assetId, symbol, chain });
  const [failed, setFailed] = useState(false);
  const wrap = ["medal", "tkicon", className].filter(Boolean).join(" ");

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
      <img src={icon.src} alt={label ?? ""} data-logo={icon.key} width={38} height={38} onError={() => setFailed(true)} />
    </span>
  );
}
