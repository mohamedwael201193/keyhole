import { VerifyView } from "./view";
export const metadata = { title: "Verify · KEYHOLE" };
export default async function Page({ searchParams }: { searchParams: Promise<{ call?: string }> }) {
  const { call } = await searchParams;
  return <VerifyView initial={typeof call === "string" ? call : null} />;
}
