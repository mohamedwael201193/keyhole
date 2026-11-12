import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { resolveLogState } from "@/lib/logState";
import type { Attestation } from "@/lib/verify";

// Real mainnet attestation (build 6367401a is in the identity history list).
const a = JSON.parse(readFileSync(`${__dirname}/fixtures/att_f4768da8.json`, "utf8")) as Attestation;
const OLD = a.executed_wasm_sha256;
const NEW = "34bf835cea7c9977bbd3270851eb27290dd35db4a0afa4652161664f57fc7d01";

describe("resolveLogState", () => {
  it("fails closed when the live registry is unreadable", async () => {
    expect(await resolveLogState(a, null)).toBe("failed");
  });
  it("an older published build is previous (neutral), not failed", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-02T12:00:00Z"), toFake: ["Date"] });
    expect(await resolveLogState(a, NEW)).toBe("previous");
    vi.useRealTimers();
  });
  it("the live build with a real quote verifies; a different live hash does not", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-11-02T12:00:00Z"), toFake: ["Date"] });
    expect(await resolveLogState(a, OLD)).toBe("verified");
    vi.useRealTimers();
  });
  it("a quote-length-only attestation never verifies", async () => {
    const fake = { ...a, tdx_quote: "x".repeat(300) };
    expect(await resolveLogState(fake, OLD)).not.toBe("verified");
  });
  it("registry match but DCAP cannot run shows quote_unverified, not verified", async () => {
    vi.resetModules();
    vi.doMock("@/lib/dcap", () => ({ b64: () => new Uint8Array(), verifyQuote: () => { throw new Error("no dcap"); } }));
    const m = await import("@/lib/logState");
    expect(await m.resolveLogState(a, OLD)).toBe("quote_unverified");
    vi.doUnmock("@/lib/dcap");
  });
});
