/** A trait name shown in the reader's language: the translated name when there is one, else the trait as the catalogue spells it. */
export function traitLabel(t: (k: string) => string, name: string) {
  const v = t(`traits.${name}`);
  return v.startsWith("traits.") ? name : v;
}
