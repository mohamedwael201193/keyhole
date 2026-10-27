import { getHealth } from "@/lib/health";
import { MintView } from "./view";
export const revalidate = 60;
export default async function Page() { return <MintView initialOnline={(await getHealth()).online} />; }
