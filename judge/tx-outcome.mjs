/** Match a receipt proof to the documented outcome; an intentional refusal is not a success. */
export function checkTxOutcome(r, c) {
  const statuses = [r.status, ...r.receipts_outcome.map((o) => o.outcome.status)];
  const failures = statuses.filter((s) => s && s.Failure);
  if (c.expect === "exists") return [true, `found, signer ${r.transaction.signer_id}`];
  if (c.expect === "failure") {
    const matches = failures.length > 0 && typeof c.expected_error === "string" && c.expected_error.length > 0
      && failures.some((s) => JSON.stringify(s).toLowerCase().includes(c.expected_error.toLowerCase()));
    return [matches, matches ? `expected refusal: ${c.expected_error}` : `expected refusal not proven: ${c.expected_error}`];
  }
  if (c.expect !== "success") return [false, `unknown tx expectation: ${c.expect}`];
  return [failures.length === 0, failures.length ? "a receipt failed" : `ok, signer ${r.transaction.signer_id}`];
}