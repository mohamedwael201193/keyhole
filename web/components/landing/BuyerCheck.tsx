"use client";
/**
 * "Check a key before you buy it": the buyer PASS panel drawn with the same classes /key uses (app/key/key.css), so the example
 * is the real card, not a picture of it. It is labelled as an example; the values are not a live result.
 */
import "@/app/key/key.css";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

const CHECKS = [
  ["lp.ckSig", "lp.ckSigD"],
  ["lp.ckMinter", "lp.ckMinterD"],
  ["lp.ckToken", "lp.ckTokenD"],
  ["lp.ckOwner", "lp.ckOwnerD"],
  ["lp.ckAge", "lp.ckAgeD"],
  ["lp.ckLog", "lp.ckLogD"],
] as const;

export function BuyerCheck() {
  const { t } = useI18n();
  return (
    <div className="check-grid">
      <div className="check-copy">
        <h2 id="check-h" className="lp-h2">{t("lp.checkH")}</h2>
        <p className="lp-lead">{t("lp.checkLead")}</p>
        <div className="lp-cta">
          <Button href="/keys" variant="secondary" testid="keys-cta">{t("lp.browseKeys")}</Button>
        </div>
        <p className="lp-note">{t("lp.checkNote")} <Link href="/key" className="lp-link">/key</Link></p>
      </div>
      <div className="lp-mock" data-testid="buyer-example">
        <p className="lp-mock-tag">{t("lp.checkTag")}</p>
        <section className="kp-card lp-mock-card" aria-label={t("lp.checkTag")}>
          <p className="kp-verdict pass" data-ok="true">PASS</p>
          <p className="kp-say">{t("lp.checkSay")}</p>
          <ol className="kp-checks">
            {CHECKS.map(([label, detail]) => (
              <li key={label} className="kp-check">
                <span className="kp-mark ok" aria-hidden="true">✓</span>
                <div>
                  <h3>{t(label)}</h3>
                  <p>{t(detail)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
