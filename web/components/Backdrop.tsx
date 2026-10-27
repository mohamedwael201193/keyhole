import Image from "next/image";
/** Static premium backdrop for inner pages: emerald wash + faint relic. Always z-0 behind content (which sits at z-10). */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(70%_55%_at_80%_0%,rgba(0,236,151,.10),transparent_70%),radial-gradient(50%_40%_at_0%_100%,rgba(0,236,151,.05),transparent_70%)]" />
      <div className="absolute -end-24 top-10 hidden h-[520px] w-[520px] opacity-[.10] md:block">
        <Image src="/art/key-live.webp" alt="" fill sizes="520px" className="object-contain" />
      </div>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal/40 to-transparent" />
    </div>
  );
}
