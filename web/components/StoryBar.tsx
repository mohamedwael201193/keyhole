"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const STEPS = [
  { href: "/mint", n: 1, t: "Mint a key", d: "free NFT, one signature" },
  { href: "/vault", n: 2, t: "Trade privately", d: "inside the Intel TDX enclave" },
  { href: "/verify", n: 3, t: "Prove it", d: "check any call, no wallet" },
] as const;

/** What KEYHOLE is, in one line, plus the 3-step story. Shown under the nav on every page. */
export function StoryBar() {
  const path = usePathname();
  return (
    <aside className="story" aria-label="What KEYHOLE is" data-testid="storybar">
      <p className="story-one"><b>KEYHOLE</b> is an NFT that opens a private trading account sealed in an Intel TDX enclave. Whoever holds the NFT runs the account.</p>
      <ol className="story-steps">
        {STEPS.map((s) => (
          <li key={s.href} className={path === s.href ? "on" : ""}>
            <Link href={s.href} aria-current={path === s.href ? "step" : undefined}><span className="sn">{s.n}</span><span className="st">{s.t}</span><span className="sd">{s.d}</span></Link>
          </li>
        ))}
      </ol>
    </aside>
  );
}
