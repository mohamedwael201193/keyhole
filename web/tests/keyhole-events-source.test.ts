import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT_METHODS, EVENT_TITLES, KEYHOLE_EVENT_FIELDS, TOKEN_METHODS, UNDISPLAYED_KEYHOLE_EVENTS, describeChainEvent, parseKeyholeEvents } from "@/lib/chainEvents";

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
    expect([...TOKEN_METHODS, ...ACCOUNT_METHODS]).toEqual(expect.arrayContaining(["on_loan_policy", "reconcile_loan_policy", "retry_loan_policy"]));
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

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("//", i)) {
      const n = src.indexOf("\n", i);
      i = n < 0 ? src.length : n;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const n = src.indexOf("*/", i + 2);
      i = n < 0 ? src.length : n + 2;
      continue;
    }
    if (src[i] === '"') {
      out += '"';
      i += 1;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
        out += src[i];
        i += 1;
      }
      if (i < src.length) { out += '"'; i += 1; }
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

/** Drop `#[cfg(test)]` items. A `mod tests;` include has no brace; a test fn does. */
function cutCfgTest(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf("#[cfg(test)]", i);
    if (at < 0) { out += src.slice(i); break; }
    out += src.slice(i, at);
    let j = at + "#[cfg(test)]".length;
    for (;;) {
      while (j < src.length && /\s/.test(src[j])) j += 1;
      if (!src.startsWith("#[", j)) break;
      const end = src.indexOf("]", j);
      j = end < 0 ? src.length : end + 1;
    }
    const semi = src.indexOf(";", j);
    const brace = src.indexOf("{", j);
    if (brace >= 0 && (semi < 0 || brace < semi)) {
      let depth = 0;
      let k = brace;
      for (; k < src.length; k += 1) {
        if (src[k] === "{") depth += 1;
        else if (src[k] === "}") {
          depth -= 1;
          if (depth === 0) { k += 1; break; }
        }
      }
      i = k;
    } else if (semi >= 0) i = semi + 1;
    else break;
  }
  return out;
}

type FnRow = { name: string; params: string; receipt: boolean; body: string };

/** Receipt methods that can execute each displayed event, following helpers and callback names. */
function discoveryFromSources(): { token: string[]; account: string[]; byEvent: Record<string, string[]> } {
  const files = readdirSync(root).filter((file) => file.endsWith(".rs") && !file.endsWith("_tests.rs"));
  const fns = new Map<string, FnRow>();
  for (const file of files) {
    const raw = cutCfgTest(stripComments(readFileSync(join(root, file), "utf8")));
    const nearSpans: { start: number; end: number; trait: boolean }[] = [];
    for (const m of raw.matchAll(/#\[near\]\s*impl\s+(?:(\w+)\s+for\s+)?(\w+)\s*\{/g)) {
      const start = m.index + m[0].length - 1;
      let depth = 0;
      let k = start;
      for (; k < raw.length; k += 1) {
        if (raw[k] === "{") depth += 1;
        else if (raw[k] === "}") {
          depth -= 1;
          if (depth === 0) { k += 1; break; }
        }
      }
      nearSpans.push({ start, end: k, trait: Boolean(m[1]) });
    }
    for (const m of raw.matchAll(/(?:pub(?:\([^)]*\))?\s+)?fn\s+([a-zA-Z0-9_]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g)) {
      const brace = raw.indexOf("{", m.index + m[0].length);
      if (brace < 0) continue;
      let depth = 0;
      let k = brace;
      for (; k < raw.length; k += 1) {
        if (raw[k] === "{") depth += 1;
        else if (raw[k] === "}") {
          depth -= 1;
          if (depth === 0) { k += 1; break; }
        }
      }
      const span = nearSpans.find((item) => m.index >= item.start && m.index < item.end);
      const head = raw.slice(m.index, m.index + 12);
      const receipt = Boolean(span) && (span!.trait || /^pub\s+fn/.test(head));
      const prev = fns.get(m[1]);
      if (prev?.receipt) continue;
      fns.set(m[1], { name: m[1], params: m[2], receipt, body: raw.slice(brace, k) });
    }
  }
  const names = new Set(fns.keys());
  const edges = new Map<string, { sync: Set<string>; asyncNames: Set<string> }>();
  for (const [name, fn] of fns) {
    const sync = new Set<string>();
    const asyncNames = new Set<string>();
    for (const m of fn.body.matchAll(/\b(?:self\.)?([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) if (names.has(m[1])) sync.add(m[1]);
    for (const m of fn.body.matchAll(/::([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g)) if (names.has(m[1])) sync.add(m[1]);
    for (const m of fn.body.matchAll(/(?:callback|cb|function_call)\s*\(\s*"([a-zA-Z0-9_]+)"/g)) asyncNames.add(m[1]);
    edges.set(name, { sync, asyncNames });
  }
  const byEvent: Record<string, string[]> = {};
  const all = new Set<string>();
  for (const event of Object.keys(KEYHOLE_EVENT_FIELDS)) {
    const re = new RegExp(`emit_key_event\\(\\s*"${event}"`);
    const start = [...fns.entries()].filter(([, fn]) => re.test(fn.body)).map(([name]) => name);
    const seen = new Set(start);
    const queue = [...start];
    while (queue.length) {
      const cur = queue.pop()!;
      for (const [name, edge] of edges) {
        if (seen.has(name)) continue;
        if (edge.sync.has(cur) || edge.asyncNames.has(cur)) {
          seen.add(name);
          queue.push(name);
        }
      }
    }
    const methods = [...seen].filter((name) => fns.get(name)?.receipt).sort();
    byEvent[event] = methods;
    for (const method of methods) all.add(method);
  }
  const token: string[] = [];
  const account: string[] = [];
  for (const name of [...all].sort()) {
    if (/\btoken_id\s*:/.test(fns.get(name)!.params)) token.push(name);
    else account.push(name);
  }
  return { token, account, byEvent };
}

describe("displayed events are discovered on every emitting receipt", () => {
  it("matches the parsed call graph, including transfers and the collateral callback", () => {
    const found = discoveryFromSources();
    expect([...TOKEN_METHODS].sort()).toEqual(found.token);
    expect([...ACCOUNT_METHODS].sort()).toEqual(found.account);
    expect(found.byEvent.key_unlist).toEqual(expect.arrayContaining(["nft_transfer", "nft_transfer_call", "nft_transfer_payout"]));
    expect(found.byEvent.collateral_ready).toEqual(expect.arrayContaining(["register_collateral", "check_collateral", "on_collateral_checked"]));
    for (const event of Object.keys(KEYHOLE_EVENT_FIELDS)) expect(found.byEvent[event]?.length).toBeGreaterThan(0);
    for (const method of found.token) expect(TOKEN_METHODS).toContain(method);
    for (const method of found.account) expect(ACCOUNT_METHODS).toContain(method);
  });
});
