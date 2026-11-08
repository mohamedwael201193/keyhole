"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { chainName } from "@/lib/tokens";
import {
  chainMarkCacheKey, loadTokenMarkIndex, markCacheKey, networkMarkUrl, probeImage, readMarkCache, resolveTokenMark, tokenGlyph, writeMarkCache,
} from "@/lib/tokenMarks";

/**
 * A round token mark with its chain badge. The monogram (two characters, neutral chip) renders at once; a web3icons, CoinCap or
 * DexScreener mark replaces it only after the browser has loaded it. Probing starts when the mark scrolls near the viewport, so a
 * long list does not start 200 requests at once. The badge is a 12, 14 or 16 px network mark at the bottom right (none at 20 px).
 * Pure rules live in lib/tokenMarks.ts. Styles: app/ui.css (.kh-tmark).
 */
export type TokenMarkSize = 20 | 24 | 32 | 40;

const BADGE_PX: Record<TokenMarkSize, number> = { 20: 0, 24: 12, 32: 14, 40: 16 };

/** True once the element is within 160 px of the viewport. Without IntersectionObserver (server, old browsers) it is true at once. */
function useNearView() {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "160px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return { ref, near };
}

/** Network badge: the chain's web3icons network mark, or a monogram when there is none (or until it loads). */
export function ChainMark({ chain, size = 16, className }: { chain: string; size?: number; className?: string }) {
  const { ref, near } = useNearView();
  const key = chainMarkCacheKey(chain);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!near) return;
    const cached = readMarkCache(key);
    if (cached !== undefined) { setSrc(cached || null); return; }
    const url = networkMarkUrl(chain);
    if (!url) { writeMarkCache(key, ""); return; }
    let cancel = false;
    void probeImage(url).then((ok) => {
      writeMarkCache(key, ok ? url : "");
      if (!cancel && ok) setSrc(url);
    });
    return () => { cancel = true; };
  }, [near, key, chain]);
  const glyph = tokenGlyph(chainName(chain));
  const cls = ["kh-netmark", className].filter(Boolean).join(" ");
  return (
    <span ref={ref} className={cls} style={{ width: size, height: size } as CSSProperties} data-net={chain} data-mark={src ? "image" : "monogram"} aria-hidden="true">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} decoding="async" onError={() => setSrc(null)} />
      ) : (
        <span className="kh-netmark-glyph">{glyph}</span>
      )}
    </span>
  );
}

export function TokenMark({ symbol, contract, chain, assetId, size = 24, label, className }: {
  symbol: string;
  /** Contract address on `chain`. Used for the metadata lookup and the DexScreener image. */
  contract?: string | null;
  /** 1Click chain id. Adds the network badge. */
  chain?: string | null;
  /** NEAR asset id, for the self-hosted mark of the NEAR tokens. */
  assetId?: string | null;
  size?: TokenMarkSize;
  /** Set only when the mark stands alone. Beside its symbol the mark stays decorative. */
  label?: string;
  className?: string;
}) {
  const { ref, near } = useNearView();
  const key = markCacheKey(symbol, contract);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!near) return;
    const cached = readMarkCache(key);
    if (cached !== undefined) { setSrc(cached || null); return; }
    let cancel = false;
    void resolveTokenMark({ symbol, contract, assetId }, { probe: probeImage, index: loadTokenMarkIndex }).then((url) => {
      writeMarkCache(key, url ?? "");
      if (!cancel) setSrc(url);
    });
    return () => { cancel = true; };
  }, [near, key, symbol, contract, assetId]);

  const badge = chain ? BADGE_PX[size] : 0;
  const cls = ["kh-tmark", `kh-tmark--${size}`, className].filter(Boolean).join(" ");
  return (
    <span
      ref={ref}
      className={cls}
      style={{ "--tm": `${size}px` } as CSSProperties}
      data-mark={src ? "image" : "monogram"}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="kh-tmark-disc">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" width={size} height={size} decoding="async" onError={() => setSrc(null)} />
        ) : (
          <span className="kh-tmark-glyph">{tokenGlyph(symbol)}</span>
        )}
      </span>
      {chain && badge > 0 && <ChainMark chain={chain} size={badge} className="kh-tmark-net" />}
    </span>
  );
}
