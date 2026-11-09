import { Card, Icon, type IconName } from "@/components/v7";

/** The three facts under the swap, in the order the page needs them. Plain statements about how the product works. */
const ITEMS: { icon: IconName; title: string; text: string }[] = [
  { icon: "shield", title: "Private by design", text: "Trades run inside the enclave, in your key's vault." },
  { icon: "layers", title: "NEAR Intents", text: "Quotes come from NEAR Intents solvers. No extra wallet." },
  { icon: "activity", title: "Real settlement", text: "Check every trade with its proof." },
];

/** A three-up strip under the swap. Static copy only; no numbers. */
export function SwapFeatures() {
  return (
    <Card as="section" className="sw-features" label="How swaps work" testid="swap-features">
      {ITEMS.map((it) => (
        <div className="sw-feat" key={it.title}>
          <span className="sw-feat-ico" aria-hidden="true"><Icon name={it.icon} size={30} /></span>
          <div className="sw-feat-text">
            <h3 className="sw-feat-title">{it.title}</h3>
            <p className="sw-feat-line">{it.text}</p>
          </div>
        </div>
      ))}
    </Card>
  );
}
