import { VaultView } from "./view";
export const revalidate = 60;
export default function Page() { return <VaultView initialOnline={false} />; }
