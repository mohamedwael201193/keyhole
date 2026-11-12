import { Workspace } from "@/components/dashboard/Workspace";
// The personal dashboard: every section a holder uses (/dashboard#swap, #vault, #keys, #pledge, #activity, #proof). Sections: components/dashboard/Workspace.tsx.
export const metadata = { title: "Dashboard · KEYHOLE" };
export default function Page() { return <Workspace />; }
