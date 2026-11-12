import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { Icon, Skeleton } from "@/components/v7";
import type { MineState } from "./orders";
import { dashHref } from "@/lib/dashboardSections";

/**
 * The small inline card that stands where "Your vault" rows would be, for every state that is not ready. Each action is real:
 * "Sign in" starts the wallet sign-in, "Unlock session" starts the same session the top-bar pill starts, "Retry" reads the
 * history again, "Mint a key" opens /mint. A state without an action says what is being waited for, and nothing is counted.
 */
export type MineGateProps = {
  state: MineState;
  unlocking: boolean;
  /** The message for a failed unlock, already in plain words. */
  unlockError: string | null;
  /** The message for a failed history read, already in plain words. */
  readError: string | null;
  onUnlock: () => void;
  onConnect: () => void;
  onRetry: () => void;
};

export function MineGate(p: MineGateProps) {
  if (p.state === "ready") return null;
  const frame = (title: string, body: string, action?: ReactNode, extra?: ReactNode) => (
    <section className="act-gate" data-testid="mine-gate" data-state={p.state} aria-labelledby="act-gate-h">
      <span className="act-gate-ico" aria-hidden="true"><Icon name="unlock" size={20} /></span>
      <h3 id="act-gate-h" className="act-gate-title">{title}</h3>
      <p className="act-gate-body">{body}</p>
      {extra}
      {action && <div className="act-gate-action">{action}</div>}
    </section>
  );

  switch (p.state) {
    case "signed-out":
      return frame(
        "Unlock to see your own trades",
        "Your trades come from the signed history of your key. Sign in with the account that holds it, then unlock the session.",
        <Button variant="primary" onClick={p.onConnect} testid="mine-connect">Sign in</Button>,
      );
    case "keys-loading":
      return frame("Unlock to see your own trades", "Looking up the key on this account.", undefined, <Skeleton lines={1} label="Looking up your key" />);
    case "no-key":
      return frame(
        "No key on this account yet",
        "Your own trades belong to a key. Mint one to start this vault's history.",
        <Button variant="primary" href={dashHref("/mint")} testid="mine-mint">Mint a key</Button>,
      );
    case "locked":
      return frame(
        "Unlock to see your own trades",
        "Unlocking starts the session for your key, the same one the top bar starts. Your trades load once it is open.",
        <Button variant="primary" onClick={p.onUnlock} loading={p.unlocking} loadingLabel="Unlocking" testid="mine-unlock">Unlock session</Button>,
        p.unlockError ? <p className="act-note act-alert" role="alert" data-testid="mine-unlock-err">{p.unlockError}</p> : null,
      );
    case "reading":
      return frame("Your trades", "Reading your trades from the enclave.", undefined, <Skeleton lines={2} label="Reading your trades" />);
    case "error":
      return frame(
        "Your trades could not be read",
        p.readError ?? "The enclave did not answer. Try again in a moment.",
        <Button variant="secondary" onClick={p.onRetry} testid="mine-retry">Try again</Button>,
      );
    case "checking":
      return frame("Your trades", "Checking the log before any entry is shown.", undefined, <Skeleton lines={1} label="Checking the log" />);
    case "unverified":
      return frame(
        "Your trades are hidden",
        "The log did not verify, so no entries are shown and none are counted.",
      );
  }
}
