"use client";

/**
 * The golden keyhole emblem plus a wordmark. The emblem is used as-is
 * (gold on black); the wordmark ink/light comes from the surrounding text
 * colour (ecru nav, teal nav, footer). The emblem is square, so the image
 * is sized 1:1 (see .kh-logo img in heirloom.css). The file is a 256px WebP
 * (20 KB): the largest display is 64px, so 256px covers retina, and the
 * 1254px PNG it replaced was the slowest asset on the page by 8x. The PNG
 * stays in public/brand only as the metadata icon (app/layout.tsx).
 */
export function KeyholeLogo({ className = "h-9", tone = "ink" }: { className?: string; tone?: "ink" | "light" }) {
  return (
    <span className={`kh-logo ${className}`} role="img" aria-label="KEYHOLE" data-tone={tone}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/keyhole-emblem.webp" alt="" aria-hidden="true" width={256} height={256} decoding="sync" />
      <span className="kh-word">KEYHOLE</span>
    </span>
  );
}
