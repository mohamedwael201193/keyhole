"use client";
import { PageHeader } from "@/components/v7";
import { AttackBoard } from "@/components/judge/AttackBoard";
import "../verify/verify.css";

/** Judge attack desk: re-check real refusals. No wallet. No value moves. */
export function AttackView() {
  const run = () => {
    document.getElementById("attack-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.querySelector<HTMLButtonElement>("[data-testid=\"attack-rerun\"]")?.click();
  };
  return (
    <div className="kp-root atk-page" data-testid="attack-page">
      <PageHeader
        eyebrow="Attack"
        title={<>Try to steal a <em>key</em>.</>}
        lead="Every card re-fetches a real mainnet refusal or transfer. Nothing here signs, pays, or moves funds."
        actions={
          <button type="button" className="kh-btn kh-btn--primary kh-btn--sm" data-testid="attack-primary" onClick={run}>
            Run the refusals
          </button>
        }
        testid="attack-head"
      />
      <div id="attack-board">
        <AttackBoard />
      </div>
      <p className="atk-foot">Source evidence: docs/evidence/prompt-injection and docs/evidence/ownership-and-limits. Open each /verify link to re-run the 37 browser checks on that call.</p>
    </div>
  );
}
