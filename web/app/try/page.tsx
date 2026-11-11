import { TrialView } from "./view";

export const metadata = { title: "Try it free · testnet · KEYHOLE" };

export default async function TrialPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const q = await searchParams;
  return <TrialView autostart={q.start === "1"} />;
}
