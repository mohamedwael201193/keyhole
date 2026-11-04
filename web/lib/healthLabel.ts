/** One line for the health strip on /judge and /vault, from /api/health ({at, online, reason}). */
export interface HealthView { at: number; online: boolean; reason: string | null }
export function healthLabel(h: HealthView | null | "error"): { state: "ok" | "down" | "wait"; text: string } {
  if (h === null) return { state: "wait", text: "Checking the enclave…" };
  if (h === "error" || typeof h !== "object") return { state: "down", text: "Health check unreachable. The proofs on this page still verify without us." };
  const when = new Date(h.at).toISOString().slice(11, 16) + " UTC";
  if (h.online) return { state: "ok", text: `Enclave online: a live info call answered at ${when}` };
  const why = h.reason === "service_unfunded" ? "the OutLayer payment balance is empty" : h.reason === "network" ? "OutLayer did not answer" : "the gateway is not configured";
  return { state: "down", text: `Enclave offline at ${when}: ${why}. Every proof on this page still verifies from public data.` };
}
