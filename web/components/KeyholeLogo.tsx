"use client";

/**
 * The golden keyhole emblem plus a wordmark. The emblem is used as-is
 * (gold on black); the wordmark ink/light comes from the surrounding text
 * colour (ecru nav, teal nav, footer). The emblem is square, so the image
 * is sized 1:1 (see .kh-logo img in heirloom.css).
 */
export function KeyholeLogo({ className = "h-9", tone = "ink" }: { className?: string; tone?: "ink" | "light" }) {
  return (
    <span className={`kh-logo ${className}`} role="img" aria-label="KEYHOLE" data-tone={tone}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/keyhole-emblem.png" alt="" aria-hidden="true" width={1254} height={1254} decoding="sync" />
      <span className="kh-word">KEYHOLE</span>
    </span>
  );
}
