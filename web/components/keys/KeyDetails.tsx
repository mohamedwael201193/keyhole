"use client";
import { useRef } from "react";
import { KeyArt } from "@/components/Art";
import { Cipher } from "@/components/Cipher";
import { traitLabel } from "@/components/KeyCard";
import { Button } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { KEYS_CONTRACT } from "@/lib/config";
import { nearText, shortAccount, shortKeyId } from "@/lib/near";
import { CAPS, keyIdentity, serialOf } from "@/lib/traits";
import { formatTradePrice } from "@/lib/price";
import { Card, CopyButton, Icon, IconButton, StatusChip, TierChip, TxLinkPill } from "@/components/v7";
import type { SaleRead } from "./keyData";

/**
 * KEY DETAILS: the selected key, large. Used by /keys and /gallery (the selected card) and by /key (the page's key). Every
 * value comes from a chain read the caller passes in; `undefined` means not read yet and is shown as such.
 * Actions are real links: Open in vault (holder), View proof, and the sale actions, which live on the key page (`saleHref`).
 * There is no transfer action.
 */
export function KeyDetails({ tokenId, owner, tier, viewer, sale, proofHref, saleHref }: {
  tokenId: string;
  /** The holder on chain. undefined while read, null when the read failed. */
  owner: string | null | undefined;
  /** nft_tier. undefined while read, null when the read failed. */
  tier: number | null | undefined;
  viewer: string | null;
  sale: SaleRead | undefined;
  proofHref: string;
  saleHref: string;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const id = keyIdentity(tokenId, tier ?? null);
  const serial = serialOf(id.seedHex);
  const title = t("gallery.key", { id: shortKeyId(tokenId) });
  const isOwner = !!viewer && owner === viewer;
  const listed = sale !== undefined && sale !== null && typeof sale === "object" ? sale : null;

  let saleLine: string;
  if (sale === undefined || sale === "reading") saleLine = "Reading the sale status from NEAR mainnet.";
  else if (sale === "error") saleLine = "The sale status could not be read just now.";
  else if (sale === "unavailable") saleLine = "Selling is not open on this contract yet.";
  else if (sale) saleLine = `For sale for ${nearText(sale.price)} NEAR, from ${shortAccount(sale.seller, 6)}.`;
  else saleLine = "Not for sale.";

  return (
    <Card as="section" className="kd-panel v7-rise" labelledBy="kd-h" testid="key-details">
      <div className="kd-art">
        <KeyArt n={id.art} alt={title} width={430} height={1080} />
        <IconButton label="Show the key larger" icon="maximize" onClick={() => dialog.current?.showModal?.()} testid="key-expand" />
      </div>

      <div className="kd-body">
        <p className="v7-eyebrow">Key details</p>
        <div className="kd-head">
          <h2 id="kd-h" className="kd-title" data-testid="kd-title">{title}</h2>
          <div className="kd-chips">
            {tier === null ? <TierChip tier="Tier not read" /> : tier === undefined ? <StatusChip tone="neutral" icon="none">Reading tier</StatusChip> : <TierChip tier={id.finish} />}
            <span className="kd-oneofone">{t("land.oneOfOne")}</span>
          </div>
        </div>
        <p className="kd-explain">Your NFT is the account: whoever holds the key controls the vault, and selling the key hands over the account. The keys to the money never leave the enclave.</p>

        <dl className="kd-traits" data-testid="kd-traits">
          <div><dt>{t("field.head")}</dt><dd>{traitLabel(t, id.head)}</dd></div>
          <div><dt>{t("field.gem")}</dt><dd>{traitLabel(t, id.gem)}</dd></div>
          <div><dt>{t("field.filigree")}</dt><dd>{traitLabel(t, id.filigree)}</dd></div>
          <div><dt>{t("field.shaft")}</dt><dd>{traitLabel(t, id.shaft)}</dd></div>
          <div><dt>{t("field.enamel")}</dt><dd>{traitLabel(t, id.enamel)}</dd></div>
          <div><dt>Serial</dt><dd className="kd-mono">{serial}</dd></div>
          <div><dt>{t("field.cipher")}</dt><dd className="kd-cipher"><Cipher bits={id.bits} width={112} height={22} /><span className="kd-mono">{id.bits}</span></dd></div>
          <div><dt>Token</dt><dd className="kd-mono kd-token"><span>{tokenId}</span><CopyButton value={tokenId} label="Copy token id" testid="kd-copy-token" /></dd></div>
          <div><dt>Holder</dt><dd>{owner === undefined ? "Reading…" : owner === null ? "Not readable right now." : <span className="kd-mono">{shortAccount(owner, 8)}</span>}{isOwner && <StatusChip tone="success">You hold it</StatusChip>}</dd></div>
          <div><dt>Contract</dt><dd><TxLinkPill account={KEYS_CONTRACT} label={KEYS_CONTRACT} testid="kd-contract" /></dd></div>
        </dl>

        <p className="kd-sale" data-testid="kd-sale">{saleLine}</p>
        <p className="kd-cap">{tier === null || tier === undefined ? "" : `${formatTradePrice(CAPS[id.finish].perTx)} · $${CAPS[id.finish].daily} / day`}</p>

        <div className="kd-actions">
          {isOwner && <Button href="/vault" icon={<Icon name="vault" size={18} />} testid="kd-open-vault">Open in vault</Button>}
          <Button href={proofHref} variant="secondary" icon={<Icon name="shield" size={18} />} testid="kd-proof">View proof</Button>
          {isOwner && (
            <Button href={saleHref} variant="secondary" icon={<Icon name="tag" size={18} />} testid="kd-sale-link">
              {listed ? "Manage sale" : "List for sale"}
            </Button>
          )}
          {!isOwner && listed && (
            <Button href={saleHref} testid="kd-buy-link" icon={<Icon name="tag" size={18} />}>View and buy</Button>
          )}
        </div>
      </div>

      <dialog ref={dialog} className="kd-dialog" aria-labelledby="kd-dialog-h" data-testid="key-expanded">
        <div className="kd-dialog-body">
          <div className="kd-dialog-top">
            <p id="kd-dialog-h" className="kd-dialog-title">{title}</p>
            <IconButton label="Close" icon="x" onClick={() => dialog.current?.close()} testid="key-expanded-close" />
          </div>
          <div className="kd-dialog-art">
            <KeyArt n={id.art} alt={title} width={430} height={1080} />
          </div>
        </div>
      </dialog>
    </Card>
  );
}
