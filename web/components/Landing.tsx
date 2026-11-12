"use client";
/**
 * The home page, eight sections, one idea each, one screen each (DESIGN_SPEC.md, section list):
 * hero, the problem, how it works (the pinned keyhole moment), the lock-out, pledge, live proof, for builders, close.
 * Every data hook is kept: the supply and the token reach come from the server (app/page.tsx, loadLanding and loadTokenReach),
 * the mainnet panel polls /api/mainnet-stats, and the trial link goes to /try.
 */
import { HomeMotion } from "./HomeMotion";
import { LandingHero } from "./landing/LandingHero";
import { Problem } from "./landing/Problem";
import { KeyholeSteps } from "./landing/KeyholeMoment";
import { Lockout } from "./landing/Lockout";
import { Pledge } from "./landing/Pledge";
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
      <KeyholeSteps />
      <Lockout />
      <Pledge />
      <ProofBand supply={supply} hash={hash} reach={reach} orders={publicOrderCensus()} />
      <Builders />
      <Close />
    </div>
  );
}
