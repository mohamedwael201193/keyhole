"use client";
/**
 * The lock-out, the second dealt moment. Two tall panels: the previous holder is refused (the real code `not_owner`), the new
 * holder's account is open. The REFUSED stamp lands once when the section first reaches the viewport (scale 1.15 to 1, 300 ms,
 * then still). Under reduced motion or ?static the stamp is simply there. Labels are on the panels, not under them.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { tx } from "@/lib/config";

/** The transfer that moved the key (the sale tx cited in README.md, section "Current build"). */
const TRANSFER_TX = "G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD";

export function Lockout() {
  const { t } = useI18n();
  const ref = useRef<HTMLElement>(null);
  const [stamp, setStamp] = useState<"rest" | "armed" | "on">("rest");

  useEffect(() => {
    const el = ref.current;
    const still = new URLSearchParams(location.search).has("static") || document.documentElement.classList.contains("no-motion") || matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el) return;
    if (still || !("IntersectionObserver" in window)) { setStamp("on"); return; }
    setStamp("armed");
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setStamp("on"); io.disconnect(); }
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="lp-sec lp-lock" id="lockout" aria-labelledby="lockout-h" ref={ref}>
      <div className="lp-wrap">
        <p className="lp-eyebrow">{t("landing2.lock.eyebrow")}</p>
        <h2 id="lockout-h" className="lp-h2">{t("landing2.lock.h2")}</h2>
        <div className="lp-panels">
          <figure className="lp-panel" data-testid="lock-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/lockout-left.webp" alt={t("landing2.lock.altLeft")} width={896} height={1200} loading="lazy" decoding="async" />
            <span className="lp-tag lp-tag--top">{t("landing2.lock.prevLabel")}</span>
            <span className="lp-stamp" data-state={stamp} aria-hidden="true">{t("landing2.lock.stamp")}</span>
            <code className="lp-code">{t("landing2.lock.prevCode")}</code>
          </figure>
          <figure className="lp-panel" data-testid="lock-right">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/lockout-right.webp" alt={t("landing2.lock.altRight")} width={896} height={1200} loading="lazy" decoding="async" />
            <span className="lp-tag lp-tag--top lp-tag--brass">{t("landing2.lock.newLabel")}</span>
            <span className="lp-open">{t("landing2.lock.newState")}</span>
          </figure>
        </div>
        <p className="lp-proven">
          <span>{t("landing2.lock.proven")}</span>
          <a href={tx(TRANSFER_TX)} target="_blank" rel="noopener noreferrer" className="lp-link">{t("landing2.lock.tx")} ↗</a>
          <Link href="/attack" className="lp-link">{t("landing2.lock.attack")}</Link>
        </p>
      </div>
    </section>
  );
}
