import { GalleryView } from "../gallery/view";
// Keys: the gallery opened on My keys (the connected account's keys, from the shared key store). /gallery opens on All keys.
export const metadata = { title: "Keys · KEYHOLE" };
export default function Keys() { return <GalleryView initial="mine" />; }
