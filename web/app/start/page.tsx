import { redirect } from "next/navigation";
import { StartView } from "./view";
export const metadata = { title: "Start · Keyhole" };
/**
 * /start is a redirect to the dashboard, where the same five setup states now live as an inline
 * checklist card (components/dashboard/Overview.tsx). The route stays alive only for two cases: old
 * links, and /start?step=connect, which holds the sign-in step open for switching accounts instead of
 * auto-advancing away from it.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const q = await searchParams;
  if (q.step === "connect") return <StartView forceStep="connect" />;
  redirect("/dashboard");
}
