"use client";
import { useEffect } from "react";
import { ErrorBox, Attested, OfflineState } from "@/components/Result";
import { TxResult } from "@/components/TxResult";
import { TxLinkPill, Card, CardHeader, EmptyState, Icon, PageHeader, TierChip } from "@/components/v7";
import { KEYS_CONTRACT } from "@/lib/config";
import { useI18n } from "@/lib/i18n";
import { useWallet } from "@/lib/wallet";
import { useSigned } from "@/lib/useSigned";
import { useHealth } from "@/lib/useHealth";
import { useKeyStore } from "@/lib/keyStore";
import { shortKeyId } from "@/lib/near";
import { keyIdentity, serialOf } from "@/lib/traits";
import { traitLabel } from "@/components/KeyCard";
import { Cipher } from "@/components/Cipher";
import { KeyArt } from "@/components/Art";
import { saveMintTx } from "@/lib/mintTx";
import { Button } from "@/components/ui";
import { MintStepper, PreviewCarousel, TierOption, type MintStep, type PreviewSlide } from "@/components/keys/MintParts";
import "@/components/keys/keys.css";

/** Remember the mint tx so /start and /vault can link it. */
function MintTxSave({ hash }: { hash: string }) { const { accountId } = useWallet(); useEffect(() => { saveMintTx(accountId, hash); }, [accountId, hash]); return null; }

/**
 * The four finishes for the preview carousel. Art numbers are the ones the mint page has always shown per finish; the art a
 * minted key gets depends on its token id (see keyIdentity), so the preview is a picture of the finish, not a promise.
 */
const SLIDES: PreviewSlide[] = [
  { finish: "Bronze", art: 3, mintable: true },
  { finish: "Silver", art: 4, mintable: false },
  { finish: "Gold", art: 2, mintable: false },
  { finish: "Legendary", art: 1, mintable: false },
];

/** The real rule that earns each finish (tee/worker/src/level.rs TIER_RULES; Legendary per lib/traits.ts finishOf). */
const EARN: Record<"Silver" | "Gold" | "Legendary", string> = {
  Silver: "Earned by trading: 10 settled swaps and $5 of volume on the key.",
  Gold: "Earned by trading: 40 settled swaps and $50 of volume on the key.",
  Legendary: "A rare Gold finish: about 1 in 8 Gold keys is finished as Legendary. It is earned after Gold.",
};

const WHAT = [
  "A unique KEYHOLE key NFT",
  "A sealed vault inside Intel TDX",
  "Private swaps and settlements",
  "Works with NEAR Intents",
] as const;

export function MintView({ initialOnline }: { initialOnline: boolean }) {
  const { t, fmtUsd } = useI18n();
  const { accountId, connect } = useWallet();
  const store = useKeyStore();
  const m = useSigned("mint");
  const online = useHealth(initialOnline);
  const o = m.res?.output;
  const revealed = !!(o?.ok && o.token_id);
  const idn = revealed ? keyIdentity(String(o.token_id), 1) : null;
  /** A key the store has read for this account. Not shown while the store is still reading. */
  const holds = !!accountId && store.status === "ready" && store.keys.length > 0;
  /** The signature is in once the wallet step has passed (the enclave is checking or settling). */
  const signed = m.busy && m.stage !== "wallet";

  const steps: MintStep[] = [
    { id: "tier", label: "Choose tier", state: "done" },
    { id: "sign", label: "Sign once", state: revealed || signed ? "done" : "current" },
    { id: "mint", label: "Mint & receive", state: revealed ? "done" : signed ? "current" : "todo" },
  ];

  return (
    <div className="kp-root km-root" data-testid="mint-page">
      <PageHeader
        eyebrow="Mint"
        title={<>Mint your <em>key.</em></>}
        lead="Create a new KEYHOLE key as an NFT. The TEE-held minter pays and mints it to you."
        testid="mint-head"
      />
      <MintStepper steps={steps} />

      <div className="km-grid">
        <div className="km-left">
          {revealed && idn ? (
            <Card as="section" className="km-keycard v7-rise" labelledBy="mint-key-h" testid="mint-key">
              <CardHeader title="Your key" id="mint-key-h" level={2} meta={<TierChip tier={idn.finish} />} />
              <div className="km-stage">
                <KeyArt n={idn.art} alt={t("gallery.key", { id: shortKeyId(String(o.token_id)) })} width={430} height={1080} className="km-art" />
              </div>
              <p className="km-caption-name" title={String(o.token_id)}>{t("gallery.key", { id: shortKeyId(String(o.token_id)) })}</p>
              <p className="km-caption-cap">Serial <span className="km-mono">{serialOf(idn.seedHex)}</span></p>
            </Card>
          ) : (
            <Card as="section" className="km-preview v7-rise" labelledBy="mint-preview-h" testid="mint-preview">
              <CardHeader title="Bronze preview" id="mint-preview-h" level={2} meta={<span className="km-tag">Preview</span>} />
              <PreviewCarousel slides={SLIDES} />
            </Card>
          )}
        </div>

        <div className="km-right">
          {revealed && idn ? (
            <Card as="section" className="km-reveal v7-rise" labelledBy="mint-reveal-h" testid="mint-revealed">
              <p className="v7-eyebrow">Minted</p>
              <h2 id="mint-reveal-h" className="km-reveal-title">{t("mint.revealedA")}<em>{t("mint.revealedB")}</em></h2>
              <p className="km-reveal-lead">{t("mint.forged")}</p>
              <dl className="km-traits">
                {(["head", "filigree", "enamel", "gem", "shaft"] as const).map((k) => (
                  <div key={k}><dt>{t(`field.${k}`)}</dt><dd>{traitLabel(t, idn[k])}</dd></div>
                ))}
                <div><dt>{t("field.cipher")}</dt><dd><Cipher bits={idn.bits} /></dd></div>
              </dl>
              <p className="km-caps" data-testid="minted">
                {t("mint.capsLine", { finish: t(`finish.${idn.finish}`), tx: fmtUsd(idn.perTx * 1e6), day: fmtUsd(idn.daily * 1e6) })}
              </p>
              <div className="km-result">
                <TxResult
                  state="confirmed"
                  title={t("mint.done")}
                  hash={typeof o.tx === "string" ? o.tx : undefined}
                  callId={m.res?.call_id ?? undefined}
                  testid="mint-result"
                >
                  {typeof o.tx === "string" && <MintTxSave hash={o.tx} />}
                  <div className="km-next">
                    <Button href="/vault" size="lg" testid="mint-open-vault">{t("mint.openVault")}</Button>
                    <Button href="/swap" variant="secondary" size="lg" testid="mint-swap">{t("mint.swap")}</Button>
                  </div>
                </TxResult>
              </div>
            </Card>
          ) : (
            <Card as="section" className="km-tiers-card v7-rise" labelledBy="mint-tiers-h" testid="mint-tiers">
              <CardHeader title="Choose a tier" id="mint-tiers-h" level={2} />
              <div className="km-tiers">
                <TierOption finish="Bronze" mintable rule="Minting gives a Bronze key: the caps the enclave enforces from day one." />
                <TierOption finish="Silver" mintable={false} rule={EARN.Silver} />
                <TierOption finish="Gold" mintable={false} rule={EARN.Gold} />
                <TierOption finish="Legendary" mintable={false} rule={EARN.Legendary} />
              </div>
              <p className="km-note" data-testid="mint-bronze-only">{t("mint.bronzeOnly")}</p>
            </Card>
          )}

          <div className="km-bottom">
            {!revealed && (
              <Card as="section" className="km-details v7-rise" labelledBy="mint-details-h" testid="mint-details">
                <CardHeader title="Mint details" id="mint-details-h" level={2} />
                <dl className="km-dl">
                  <div>
                    <dt>Minting to</dt>
                    <dd data-testid="mint-to">{accountId ? <span className="km-mono">{accountId}</span> : "Sign in to choose the account"}</dd>
                  </div>
                  <div>
                    <dt>Network</dt>
                    <dd><span className="km-net"><i aria-hidden="true" />NEAR mainnet</span></dd>
                  </div>
                  <div>
                    <dt>Contract</dt>
                    <dd><TxLinkPill account={KEYS_CONTRACT} label={KEYS_CONTRACT} testid="mint-contract" /></dd>
                  </div>
                  <div>
                    <dt>Cost to you</dt>
                    <dd data-testid="mint-cost"><b>0 NEAR</b><small>No gas. You sign one message; the TEE-held minter pays the mint.</small></dd>
                  </div>
                </dl>

                {holds && <p className="km-note" role="status" data-testid="mint-holds">This account already holds a key. One key per account.</p>}
                {online === false && <OfflineState />}
                {online !== false && !accountId && (
                  <EmptyState title={t("empty.mintTitle")} body={t("empty.mintBody")} testid="mint-empty"
                    action={<Button onClick={connect} testid="mint-connect">{t("nav.connect")}</Button>} />
                )}
                {online !== false && accountId && (
                  <div className="km-action">
                    <Button
                      size="lg"
                      block
                      icon={<Icon name="mint" size={18} />}
                      disabled={holds}
                      loading={m.busy}
                      loadingLabel={m.label || "Minting"}
                      onClick={() => void m.run({})}
                      testid="mint-btn"
                    >
                      {m.busy ? m.label : "Mint Bronze Key"}
                    </Button>
                    <p className="km-note"><Icon name="shield" size={16} /> You will sign once. The TEE-held minter will mint the NFT to you.</p>
                    {m.busy && m.stage !== "wallet" && <TxResult state="pending" title="Waiting for the enclave" testid="mint-pending" />}
                    {m.res?.error && <ErrorBox code={m.res.error.code} retryAfter={m.res.error.retry_after} />}
                    {m.res && !m.res.error && m.res.call_id && <Attested r={m.res} />}
                  </div>
                )}
              </Card>
            )}

            <div className="km-side">
              <Card as="section" className="km-get v7-rise" labelledBy="mint-get-h" testid="mint-get">
                <CardHeader title="What you get" id="mint-get-h" level={2} icon="layers" />
                <ul className="km-checks">
                  {WHAT.map((w) => <li key={w}><Icon name="check" size={16} />{w}</li>)}
                </ul>
              </Card>
              <Card as="section" className="km-how v7-rise" labelledBy="mint-how-h" testid="mint-how">
                <CardHeader title="How it works" id="mint-how-h" level={2} icon="info" />
                <ol className="km-howlist">
                  <li><span className="km-num" data-testid="step-num">01</span><p>Choose a tier that fits your usage.</p></li>
                  <li><span className="km-num" data-testid="step-num">02</span><p>Sign a single, gas-free request.</p></li>
                  <li><span className="km-num" data-testid="step-num">03</span><p>The TEE-held minter mints the NFT to you.</p></li>
                </ol>
              </Card>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
