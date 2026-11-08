import { SwapView } from "./view";
// Swap (v3-B): a live price with no wallet, and a signed swap inside the key's vault. The trade code is the vault's (lib/trade, the enclave quote and swap).
export const metadata = { title: "Swap · KEYHOLE" };
export default function Page() { return <SwapView />; }
