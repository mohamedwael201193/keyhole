import { MintView } from "./view";
export const revalidate = 60;
export default function Page() { return <MintView initialOnline={false} />; }
