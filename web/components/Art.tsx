/**
 * WebP, not AVIF. Inside a masked or transformed card, Chromium paints the
 * AVIF source as an empty box while the decoded bitmap is fine. WebP draws.
 * `priority` (the hero key) loads eagerly and decodes synchronously; every other key loads lazily and decodes off the main thread.
 * width and height are always set, so the box is reserved before the image arrives.
 */
export function KeyArt({ n, alt, className, priority, width, height }: { n: number; alt: string; className?: string; priority?: boolean; width: number; height: number }) {
  const base = `/heirloom/keys/k${String(n).padStart(2, "0")}`;
  return (
    <img
      className={className}
      src={`${base}.webp`}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding={priority ? "sync" : "async"}
    />
  );
}

export function Scene({ name, alt, className, width, height }: { name: "privacy" | "enclave"; alt: string; className?: string; width: number; height: number }) {
  return (
    <picture>
      <source media="(max-width: 800px)" srcSet={`/heirloom/${name}-800.webp`} type="image/webp" />
      <source srcSet={`/heirloom/${name}.avif`} type="image/avif" />
      <source srcSet={`/heirloom/${name}.webp`} type="image/webp" />
      <img className={className} src={`/heirloom/${name}.webp`} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </picture>
  );
}

export function Icon({ n, alt, className }: { n: number; alt?: string; className?: string }) {
  const base = `/heirloom/icons/icon${n}`;
  return (
    <picture>
      <source srcSet={`${base}.avif`} type="image/avif" />
      <source srcSet={`${base}.webp`} type="image/webp" />
      <img className={className} src={`${base}.webp`} alt={alt || ""} width={320} height={317} loading="lazy" decoding="async" />
    </picture>
  );
}
