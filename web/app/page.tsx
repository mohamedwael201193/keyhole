import { Landing } from "@/components/Landing";
import { loadLanding } from "@/lib/landing";
import { WORKER_WASM_SHA256 } from "@/lib/config";

/** Served from cache and rebuilt at most once a minute (ISR). The chain reads in loadLanding are short, shared and never throw. */
export const revalidate = 60;

export default async function Home() {
  const { supply, tokens, tiers } = await loadLanding();
  return <Landing supply={supply} hash={WORKER_WASM_SHA256[0].slice(0, 8)} tokens={tokens} tiers={tiers} />;
}
