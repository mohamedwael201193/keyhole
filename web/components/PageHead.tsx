export function PageHead({ eyebrow, title, sub }: { eyebrow?: string; title: string; sub?: string }) {
  return (
    <div className="pagehead">
      {eyebrow && <p className="eb">{eyebrow}</p>}
      <h1>{title}</h1>
      {sub && <p className="lead">{sub}</p>}
    </div>
  );
}
