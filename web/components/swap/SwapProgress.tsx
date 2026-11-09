"use client";
import { ErrorBox } from "@/components/Result";
import { Button } from "@/components/ui";
import { Icon, ProgressSteps, type ProgressStep } from "@/components/v7";

/**
 * The live panel while a signed swap runs. The steps come from the real stage (components/swap/progress.ts), and `line` is the
 * real busy line from useSigned (the stage in plain words, with the seconds it has taken). Replaces the form inside the card.
 */
export function SwapRunning({ title, line, steps }: { title: string; line: string; steps: ProgressStep[] }) {
  return (
    <section className="sw-phase" data-testid="trade-pending" aria-labelledby="sw-run-h">
      <div className="sw-phase-head">
        <span className="sw-phase-spin" aria-hidden="true"><span className="v7-spin" /></span>
        <div className="sw-phase-text">
          <h3 id="sw-run-h" className="sw-phase-title">{title}</h3>
          <p className="sw-phase-line" role="status" data-testid="trade-pending-line">{line}</p>
        </div>
      </div>
      <ProgressSteps steps={steps} label="Swap progress" testid="trade-steps" />
    </section>
  );
}

/**
 * The swap did not complete. Shows the steps (the one that stopped is in error), the real message from the enclave (ErrorBox
 * maps the code to words), and two real actions: Retry runs the same swap again, and Back returns to the form.
 */
export function SwapFailed({ steps, stoppedAt, code, retryAfter, onRetry, onBack }: {
  steps: ProgressStep[];
  /** The plain name of the step that stopped, for example "Confirm in your wallet". */
  stoppedAt: string;
  code: string;
  retryAfter?: number;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <section className="sw-phase" data-testid="trade-failed" aria-labelledby="sw-fail-h">
      <div className="sw-phase-head">
        <span className="sw-phase-ico danger" aria-hidden="true"><Icon name="x" size={20} /></span>
        <div className="sw-phase-text">
          <h3 id="sw-fail-h" className="sw-phase-title">Swap not completed</h3>
          <p className="sw-phase-line">Stopped at: {stoppedAt}.</p>
        </div>
      </div>
      <ProgressSteps steps={steps} label="Swap progress" testid="trade-steps" />
      <ErrorBox code={code} retryAfter={retryAfter} />
      <div className="sw-actions">
        <Button variant="primary" onClick={onRetry} testid="swap-retry">Retry</Button>
        <Button variant="secondary" onClick={onBack} testid="swap-back">Back to swap</Button>
      </div>
    </section>
  );
}
