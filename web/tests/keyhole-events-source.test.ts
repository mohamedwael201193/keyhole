import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EVENT_TITLES, KEYHOLE_EVENT_FIELDS, TOKEN_METHODS, UNDISPLAYED_KEYHOLE_EVENTS, describeChainEvent, parseKeyholeEvents } from "@/lib/chainEvents";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../contracts/keys/src");

function emitted(): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(root)) {
    if (!file.endsWith(".rs")) continue;
    const text = readFileSync(join(root, file), "utf8");
    for (const m of text.matchAll(/emit_key_event\(\s*"([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return [...names].sort();
}

describe("contract event kinds", () => {
  it("classifies every emit_key_event name in contracts/keys/src", () => {
    const classified = [...Object.keys(KEYHOLE_EVENT_FIELDS), ...UNDISPLAYED_KEYHOLE_EVENTS].sort();
    expect(emitted()).toEqual(classified);
    expect(KEYHOLE_EVENT_FIELDS.loan_closed).toEqual(["token_id", "nonce", "resolution"]);
    expect(EVENT_TITLES.loan_closed).toBe("Loan closed");
    expect(TOKEN_METHODS).toEqual(expect.arrayContaining(["on_loan_policy", "reconcile_loan_policy", "retry_loan_policy"]));
    const pledge = readFileSync(join(root, "pledge.rs"), "utf8");
    const at = pledge.indexOf('emit_key_event("loan_closed"');
    expect(pledge.slice(at, at + 180)).toContain('"resolution"');
    const parsed = parseKeyholeEvents([`EVENT_JSON:${JSON.stringify({ standard: "keyhole", version: "1.0.0", event: "loan_closed", data: [{ token_id: "k5f4750858f328940", nonce: "4", resolution: "repaid" }] })}`]);
    expect(parsed).toHaveLength(1);
    const described = describeChainEvent({ event: "loan_closed", standard: "keyhole", version: "1.0.0", tx: "t", atMs: null, data: parsed[0].data });
    expect(described?.title).toBe("Loan closed");
    expect(described?.detail).toContain("repaid");
  });
});
