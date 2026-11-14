/** One line for the health strip on /verify/path and /vault, from /api/health. Passive results do not claim the enclave is online. */
export interface HealthView { at: number; online: boolean | null; reason: string | null; mode?: "passive" | "active"; fresh?: boolean }
export function healthLabel(h: HealthView | null | "error"): { state: "ok" | "down" | "wait"; text: string } {
  if (h === null) return { state: "wait", text: "Reading the passive health check…" };
  if (h === "error" || typeof h !== "object") return { state: "down", text: "Health check unreachable. The proofs on this page still verify without us." };
  const when = new Date(h.at).toISOString().slice(11, 16) + " UTC";
  // Passive mode: the page re-checks claims from public data, and availability is probed only when the
  // page asks for it. Say so plainly — "was not probed" on its own reads as a broken check.
  if (h.mode === "passive" || h.online == null) return { state: "wait", text: `Availability is checked passively and was not probed at ${when} — the passive check does not spend the service balance. Proofs on this page still verify from public data.` };
  if (h.online) return { state: "ok", text: `Enclave online: an approved info probe answered at ${when}` };
  const why = h.reason === "service_unfunded" ? "the OutLayer payment balance is empty" : h.reason === "network" ? "OutLayer did not answer" : "the gateway is not configured";
  return { state: "down", text: `Enclave offline at ${when}: ${why}. Every proof on this page still verifies from public data.` };
}
