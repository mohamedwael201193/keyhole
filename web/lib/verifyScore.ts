/** Score for /verify. Fails closed: an output that was not compared is not counted as a pass,
 *  and only the current published build can earn the "genuine" stamp. */
export type Six = { quote: boolean; registered: boolean; fastfs: boolean | null; published: boolean; binding?: { match: boolean } | null; output?: { match: boolean } | null };
export function attestChecks(ck: Six): boolean[] {
  const r = [ck.quote, ck.registered, ck.fastfs === true, ck.published, ck.binding?.match === true];
  if (ck.output) r.push(ck.output.match === true);
  return r;
}
/** "current" = genuine on the published build; "previous" = genuine on a superseded build; "no" otherwise. */
export function verdict(ck: Six, buildIdx: number, dcapOk: boolean, pcsOk: boolean): "current" | "previous" | "no" {
  const pass = attestChecks(ck).every(Boolean) && dcapOk && pcsOk && buildIdx >= 0;
  return !pass ? "no" : buildIdx === 0 ? "current" : "previous";
}
/** Real client IP on Vercel (x-real-ip is set by the platform); falls back to the first forwarded hop. */
export function clientIp(h: { get(k: string): string | null }): string {
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
}
/** OutLayer attestation path; anything else (e.g. "@evil.example/x") is dropped instead of concatenated. */
export const safeAttPath = (p: unknown): p is string => typeof p === "string" && /^\/attestations\/by-call\/[0-9a-f-]{36}$/.test(p);
