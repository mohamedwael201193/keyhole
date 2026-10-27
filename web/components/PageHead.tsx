export function PageHead({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (<div className="mb-10">{eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}<h1 className="font-serif text-5xl leading-none sm:text-6xl">{title}</h1>{sub && <p className="mt-4 max-w-2xl text-zinc-300">{sub}</p>}</div>);
}
