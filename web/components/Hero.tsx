"use client";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { WORKER_WASM_SHA256 } from "@/lib/config";

const ShaderField = dynamic(() => import("./ShaderField"), { ssr: false });
export const CHAINS = [
  { id: "near", name: "NEAR", light: false }, { id: "zec", name: "ZEC", light: false }, { id: "btc", name: "BTC", light: false },
  { id: "arb", name: "ARB", light: false }, { id: "sol", name: "SOL", light: false }, { id: "base", name: "Base", light: true },
  { id: "eth", name: "ETH", light: true }, { id: "usdc", name: "USDC", light: false },
] as const;

export function Hero({ supply }: { supply: number | null }) {
  const { t, fmtNum } = useI18n();
  const stage = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ x: 0, y: 0 });
  const [field, setField] = useState(false);
  useEffect(() => {
    // Field starts after first paint and idle, never in the LCP path.
    // Start after the load event plus a beat, so shader compile never competes with first paint or input.
    let t: ReturnType<typeof setTimeout>;
    const go = () => { t = setTimeout(() => setField(true), 2500); };
    if (document.readyState === "complete") go(); else addEventListener("load", go, { once: true });
    return () => { clearTimeout(t); removeEventListener("load", go); };
  }, []);
  const onMove = (e: React.PointerEvent) => {
    const r = stage.current!.getBoundingClientRect();
    setM({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
  };
  return (
    <section className="relative grid min-h-[calc(100dvh-3.5rem)] overflow-hidden lg:grid-cols-[minmax(0,560px)_1fr]" aria-labelledby="hero-h">
      {/* Text plate: solid, the field never crosses it. */}
      <div className="plate relative z-20 flex flex-col justify-center gap-5 rounded-none border-0 border-e px-6 py-12 sm:px-10 lg:py-0">
        <p className="eyebrow hero-line" style={{ animationDelay: "0s" }}>✦ {t("hero.eyebrow")}</p>
        <h1 id="hero-h" className="font-serif text-[clamp(44px,7vw,84px)] leading-[0.98] tracking-tight">
          <span className="hero-line block" style={{ animationDelay: ".05s" }}>{t("hero.l1")}</span>
          <span className="hero-line block" style={{ animationDelay: ".15s" }}>{t("hero.l2")}</span>
          <em className="hero-line block text-signal" style={{ animationDelay: ".3s" }}>{t("hero.l3")}</em>
          <em className="hero-line block text-signal" style={{ animationDelay: ".42s" }}>{t("hero.l4")}</em>
        </h1>
        <p className="label">{t("hero.kicker")}</p>
        <p className="max-w-md text-[15px] leading-relaxed text-zinc-300">{t("hero.body")}</p>
        <div className="flex flex-wrap gap-3">
          <Link href="/vault" className="btn btn-signal">{t("hero.cta")}</Link>
          <Link href="/verify" className="btn btn-ghost">{t("hero.cta2")}</Link>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-4">
          <div><dt className="label order-2 mt-1">{t("hero.s1")}</dt><dd className="font-serif text-3xl" data-testid="supply">{supply == null ? "—" : fmtNum(supply)}</dd></div>
          <div><dt className="label mt-1">{t("hero.s2")}</dt><dd className="font-serif text-3xl">$1.00</dd></div>
          <div><dt className="label mt-1">{t("hero.s3")}</dt><dd className="font-mono text-xl text-white">{WORKER_WASM_SHA256[0].slice(0, 8)}</dd></div>
        </dl>
        <p className="label"><span className="me-1 inline-block h-1.5 w-1.5 rounded-full bg-signal align-middle" />{t("hero.live")}</p>
      </div>

      {/* Stage */}
      <div ref={stage} onPointerMove={onMove} onPointerLeave={() => setM({ x: 0, y: 0 })} className="relative isolate min-h-[560px] overflow-hidden">
        {field && <ShaderField />}
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative aspect-square w-[min(88vw,620px)]">
            {/* orbit ring (moves less = farther) */}
            <div className="depth absolute inset-0" style={{ transform: `translate3d(${m.x * -14}px, ${m.y * -14}px, 0)` }}>
              <div className="orbit absolute inset-0">
                {CHAINS.map((c, i) => {
                  const a = (i / CHAINS.length) * Math.PI * 2 - Math.PI / 2;
                  return (
                    <div key={c.id} className="absolute" style={{ left: `${50 + Math.cos(a) * 47}%`, top: `${50 + Math.sin(a) * 47}%`, transform: "translate(-50%,-50%)" }}>
                      <div className="orbit-in" style={{ animationDelay: `${5.6 + i * 0.12}s` }}>
                        <div className="counter flex flex-col items-center gap-1">
                          <span className={`grid h-12 w-12 place-items-center rounded-full shadow-[0_6px_24px_rgba(0,0,0,.6),inset_0_1px_0_rgba(255,255,255,.25)] ${c.light ? "bg-gradient-to-b from-white to-zinc-200 ring-1 ring-white/70" : "bg-gradient-to-b from-zinc-800 to-black ring-1 ring-white/15"}`}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/logos/${c.id}.svg`} alt={c.name} width={26} height={26} className="h-[26px] w-[26px]" />
                          </span>
                          <span className="rounded bg-black/80 px-1.5 font-mono text-[10px] text-zinc-300">{c.name}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* relic (moves more = nearer) */}
            <div className="depth absolute inset-[16%]" style={{ transform: `translate3d(${m.x * 26}px, ${m.y * 26}px, 0) rotateX(${m.y * -6}deg) rotateY(${m.x * 8}deg)` }}>
              <div className="halo absolute inset-[28%] rounded-full bg-signal/25 blur-3xl" />
              <div className="relic aperture relative h-full w-full">
                <Image src="/art/key-live.webp" alt="The KEYHOLE relic: a keyed disc with a glowing aperture" fill priority fetchPriority="high" sizes="(max-width: 1024px) 70vw, 440px" className="object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,.8)]" />
              </div>
            </div>
          </div>
        </div>
        {/* beam to the vault card */}
        <div className="pointer-events-none absolute end-[min(4vw,40px)] top-[74%] z-10 hidden -translate-y-1/2 items-center xl:flex">
          <div className="beam h-[3px] w-[110px] bg-gradient-to-r from-transparent via-signal to-signal shadow-[0_0_18px_#00ec97]" />
          <div className="vaultcard plate w-[230px] p-4 shadow-[0_0_40px_-10px_rgba(0,236,151,.5)]" style={{ borderColor: "rgba(0,236,151,.5)" }}>
            <p className="eyebrow">{t("hero.vault")}</p>
            <p className="mt-2 font-serif text-2xl">{t("hero.vaultSub")}</p>
            <p className="label mt-2">over-cap → refused · <a className="pointer-events-auto text-signal underline" href="https://api.outlayer.ai/attestations/by-call/b8daeed3-b745-432c-98f8-0af674f0da51" target="_blank" rel="noreferrer">attested</a></p>
          </div>
        </div>
      </div>
    </section>
  );
}
