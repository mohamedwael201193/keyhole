import { getHealth } from "@/lib/health";
import { VaultView } from "./view";
export const revalidate = 60;
export default async function Page() { return <VaultView initialOnline={(await getHealth()).online} />; }
