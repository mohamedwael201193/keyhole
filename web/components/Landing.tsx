"use client";
/**
 * The home page (v2), a light heirloom page: cream paper, emerald bands, brass and gold, the real keys as the heroes.
 * Order (DESIGN_PLAN_V2): hero with the feature strip, the problem, how it works, the lock-out moment, pledge, the keys,
 * supported tokens with live mainnet numbers, then builders and the close. Every data hook is kept: the supply and the token
 * reach come from the server (app/page.tsx), the mainnet panel polls /api/mainnet-stats, and the trial link goes to /try.
 */
import { HomeMotion } from "./HomeMotion";
import { LandingHero } from "./landing/LandingHero";
import { Problem } from "./landing/Problem";
import { Steps } from "./landing/Steps";
import { Lockout } from "./landing/Lockout";
import { Pledge } from "./landing/Pledge";
import { KeysFan } from "./landing/KeysFan";
import { ProofBand } from "./landing/ProofBand";
import { Builders } from "./landing/Builders";
import { Close } from "./landing/Close";
import type { TokenReach } from "@/lib/landing";
import { publicOrderCensus } from "@/lib/settlements";

export function Landing({ supply, hash, reach }: { supply: number | null; hash: string; reach: TokenReach | null }) {
  return (
    <div className="lp">
      <HomeMotion />
      <LandingHero />
      {/* /#private is linked from the swap page (components/swap/SwapAbout.tsx): the problem section explains the private account. */}
      <div id="private"><Problem /></div>
      <Steps />
      <Lockout />
      <Pledge />
      <KeysFan />
      <ProofBand supply={supply} reach={reach} />
      <Builders hash={hash} orders={publicOrderCensus()} />
      <Close />
    </div>
  );
}
