"use client";
import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { keyState, shortAccount, tierName, type KeyState, type Token } from "@/lib/near";

const RING: Record<KeyState, string> = { locked: "border-line", unlocked: "border-signal/70", expired: "border-zinc-700", legendary: "border-amber-400/70" };

/** Live NFT card: state computed from chain data (owner, tier, expires_at) and the connected viewer. */
export function KeyNFT({ token, tier, viewer, index, total, forceState }: { token?: Token; tier?: number | null; viewer?: string | null; index?: number; total?: number; forceState?: KeyState }) {
  const { t } = useI18n();
  const state: KeyState = forceState ?? (token ? keyState(token, tier ?? null, viewer ?? null) : "locked");
  return (
    <article className={`plate group flex flex-col overflow-hidden border ${RING[state]}`} data-state={state} data-testid="key-nft">
      <header className="flex items-center justify-between px-4 pt-3"><span className="label">KEYHOLE</span>
        {index != null && total != null && <span className="label">{String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}</span>}</header>
      <div className="relative aspect-square">
        <Image src={`/art/${state}.webp`} alt={`${t(`gallery.${state}`)} key`} fill sizes="(max-width:768px) 90vw, 300px" className="object-contain transition duration-700 group-hover:scale-[1.03]" />
        {state === "unlocked" && <div className="pointer-events-none absolute inset-[38%] animate-pulse rounded-full bg-signal/20 blur-2xl" />}
      </div>
      <div className="flex flex-1 flex-col gap-1 px-4 pb-4">
        <h3 className="font-serif text-2xl">{t(`gallery.${state}`)}</h3>
        <p className="text-xs text-zinc-400">{t(`gallery.${state}_d`)}</p>
        {token && (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-400">
            <dt>token</dt><dd className="truncate text-end text-zinc-200">{token.token_id}</dd>
            <dt>{t("vault.tier")}</dt><dd className="text-end text-zinc-200">{tierName(tier)}</dd>
            <dt>{t("gallery.owner")}</dt><dd className="truncate text-end text-zinc-200" title={token.owner_id}>{shortAccount(token.owner_id)}</dd>
          </dl>
        )}
      </div>
    </article>
  );
}
