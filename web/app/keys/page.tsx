import { GalleryView } from "../gallery/view";
// Keys (v3-A): the app view of the connected account's keys, the same screen as the gallery's My keys tab. /gallery keeps every key.
export const metadata = { title: "Keys · KEYHOLE" };
export default function Keys() { return <GalleryView tokens={[]} tiers={[]} mine />; }
