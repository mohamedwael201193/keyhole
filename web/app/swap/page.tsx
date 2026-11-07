import { SettleView } from "../settle/view";
// Swap (v3-A): the quote and settlement card that already works on /settle. The swap screen is rebuilt in V3-B.
export const metadata = { title: "Swap · KEYHOLE" };
export default function Page() { return <SettleView />; }
