"use client";
/**
 * "What you get": three outcomes, each drawn with real product UI. Every value comes from a live token (the key card), the
 * settlement evidence (lib/settlements.ts) or the transfer calls on the current build (lib/evidence.ts). No stock figures.
 */
import { KeyArt } from "@/components/Art";
import { TokenIcon } from "@/components/TokenIcon";
import { useI18n } from "@/lib/i18n";
import { shortAccount, shortKeyId, type Token } from "@/lib/near";
import { CALLS } from "@/lib/evidence";
import { SETTLEMENTS } from "@/lib/settlements";
import { keyIdentity } from "@/lib/traits";

/** The first live key, as its card reads it: art, finish, short id and holder. Falls back to the honest empty state. */
export function KeyNow({ token, tier }: { token: Token | null; tier: number | null }) {
  const { t } = useI18n();
  if (!token) {
    return (
      <div className="ui-key ui-key--empty">
        <div className="ui-key-art"><KeyArt n={1} alt="" width={437} height={1084} /></div>
        <p className="ui-note">{t("home.keyNone")}</p>
      </div>
    );
  }
  const id = keyIdentity(token.token_id, tier);
  return (
    <div className="ui-key" data-testid="own-key">
      <div className="ui-key-art"><KeyArt n={id.art} alt="" width={437} height={1084} /></div>
      <div className="ui-key-body">
        <p className="ui-key-title">{t("gallery.key", { id: shortKeyId(token.token_id) })}</p>
        <dl className="ui-kv">
          <dt>{t("home.keyTier")}</dt><dd>{t(`finish.${id.finish}`)}</dd>
          <dt>{t("home.keyToken")}</dt><dd className="mono">{shortKeyId(token.token_id)}</dd>
          <dt>{t("home.keyHolder")}</dt><dd className="mono">{shortAccount(token.owner_id)}</dd>
        </dl>
      </div>
    </div>
  );
}

/** One real settled order from the evidence file, drawn as the swap card: pay, receive, route. */
const ORDER = SETTLEMENTS.find((s) => s.label.includes(" → ") && s.label.startsWith("0.004 SOL")) ?? SETTLEMENTS.find((s) => s.label.includes(" → "));

function parsePay(text: string): { amount: string; symbol: string; chain: string } {
  const m = text.match(/^([\d.]+) (\S+) on (\S+)/);
  return m ? { amount: m[1], symbol: m[2], chain: m[3] } : { amount: "", symbol: text, chain: "" };
}

function parseGet(text: string): { symbol: string; chain: string } {
  const m = text.match(/^(\S+) on (\S+)/);
  return m ? { symbol: m[1], chain: m[2] } : { symbol: text, chain: "" };
}

export function SwapNow() {
  const { t } = useI18n();
  const [payText, getText] = (ORDER?.label ?? " → ").split(" → ");
  const pay = parsePay(payText ?? "");
  const get = parseGet(getText ?? "");
  const received = ORDER?.note?.match(/([\d.]+) USDC arrived/)?.[1] ?? "";
  return (
    <div className="ui-swap" data-testid="swap-now">
      <div className="ui-leg">
        <span className="ui-leg-label">{t("home.payLabel")}</span>
        <div className="ui-leg-row">
          <TokenIcon symbol={pay.symbol} chain={pay.chain} size="lg" />
          <span className="ui-amount mono">{pay.amount}</span>
          <span className="ui-asset">{pay.symbol}<small>{pay.chain}</small></span>
        </div>
      </div>
      <span className="ui-flip" aria-hidden="true">↓</span>
      <div className="ui-leg">
        <span className="ui-leg-label">{t("home.getLabel")}</span>
        <div className="ui-leg-row">
          <TokenIcon symbol={get.symbol} chain={get.chain} size="lg" />
          <span className="ui-amount mono">{received}</span>
          <span className="ui-asset">{get.symbol}<small>{get.chain}</small></span>
        </div>
      </div>
      <p className="ui-route"><span>{t("home.routeLabel")}</span></p>
    </div>
  );
}

/** The six transfer calls the current build ran around one sale, read from the evidence file. */
export function TransferNow() {
  const { t } = useI18n();
  const rows = CALLS.filter((c) => c.label.startsWith("transfer a985fd87"));
  return (
    <div className="ui-calls" data-testid="transfer-now">
      <p className="ui-calls-title">{t("home.callsTitle")}</p>
      <ol>
        {rows.map((c) => {
          const [status, reason] = c.outcome.split(" · ");
          const ok = status === "ok";
          return (
            <li key={c.id}>
              <span className="ui-call-what">{c.label.replace("transfer a985fd87 · ", "")}</span>
              <b className="ui-call-res" data-ok={ok ? "true" : "false"}>
                {ok ? t("home.allowed") : t("home.refused")}
                {!ok && reason ? <small className="mono">{reason}</small> : null}
              </b>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
