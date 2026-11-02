import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKER_WASM_SHA256 } from "@/lib/config";
import { CALLS, PUBLISHED_INFO_CALL } from "@/lib/evidence";
import { PREVIOUS_WASM_SHA256, PUBLISHED_WASM_SHA256 } from "@/lib/verify";

// Every "current build" pointer the site shows must name the build in tee/worker/DEPLOYED_SHA256,
// and a superseded build or its call may appear only where it is labelled as previous.
const root = `${__dirname}/../..`;
const deployed = readFileSync(`${root}/tee/worker/DEPLOYED_SHA256`, "utf8").trim().split(/\s+/)[0].toLowerCase();
const prevCalls = CALLS.filter((c) => c.label.startsWith("info · previous build"));

describe("current-build pointers", () => {
  it("the first accepted hash, the published hash and tee/worker/DEPLOYED_SHA256 are the same build", () => {
    expect(WORKER_WASM_SHA256[0]).toBe(deployed);
    expect(PUBLISHED_WASM_SHA256).toBe(deployed);
  });

  it("the previous hash is second in the accepted list and no build is listed twice", () => {
    expect(WORKER_WASM_SHA256[1]).toBe(PREVIOUS_WASM_SHA256);
    expect(new Set(WORKER_WASM_SHA256).size).toBe(WORKER_WASM_SHA256.length);
  });

  it("the accepted builds are not read from an env setting", () => {
    expect(readFileSync(`${root}/web/lib/config.ts`, "utf8")).not.toMatch(/NEXT_PUBLIC_WORKER_WASM_SHA256/);
  });

  it("the /verify default call is the one evidence row labelled with the published build", () => {
    const cur = CALLS.filter((c) => c.label.startsWith("info · published build"));
    expect(cur).toHaveLength(1);
    expect(cur[0].id).toBe(PUBLISHED_INFO_CALL);
    expect(cur[0].label).toContain(deployed.slice(0, 8));
  });

  it("each previous-build info call names a superseded hash, never the published one", () => {
    expect(prevCalls.length).toBeGreaterThanOrEqual(4);
    for (const c of prevCalls) {
      const h = c.label.split(" ").pop()!;
      expect(WORKER_WASM_SHA256.slice(1).some((x) => x.startsWith(h))).toBe(true);
      expect(deployed.startsWith(h)).toBe(false);
    }
  });

  it("README, TRACK_COVERAGE and /judge link a previous-build call only on a line that says previous", () => {
    for (const f of ["README.md", "TRACK_COVERAGE.md", "web/app/judge/page.tsx"]) {
      readFileSync(`${root}/${f}`, "utf8").split("\n").forEach((line, i) => {
        for (const c of prevCalls) if (line.includes(c.id)) expect(`${f}:${i + 1} ${/previous/i.test(line)}`).toBe(`${f}:${i + 1} true`);
      });
    }
  });

  it("README, TRACK_COVERAGE and SECURITY name a superseded build's full hash only where that line, the line above, or the caption of its code block says previous or superseded", () => {
    for (const f of ["README.md", "TRACK_COVERAGE.md", "SECURITY.md"]) {
      const lines = readFileSync(`${root}/${f}`, "utf8").split("\n");
      let caption = "", inFence = false;
      lines.forEach((line, i) => {
        if (line.startsWith("```")) { inFence = !inFence; if (inFence) caption = lines.slice(Math.max(0, i - 2), i).join(" "); }
        const ctx = (inFence ? caption + " " : "") + lines.slice(Math.max(0, i - 2), i + 1).join(" ");
        for (const h of WORKER_WASM_SHA256.slice(1)) if (line.includes(h)) expect(`${f}:${i + 1} ${/previous|superseded/i.test(ctx)}`).toBe(`${f}:${i + 1} true`);
      });
    }
  });

  it("the /judge verify link's text names the same call as its href", () => {
    const src = readFileSync(`${root}/web/app/judge/page.tsx`, "utf8");
    const links = [...src.matchAll(/href="\/verify\?call=([0-9a-f]{8})[^"]*">[^<]*?call ([0-9a-f]{8})/g)];
    expect(links.length).toBeGreaterThan(0);
    for (const m of links) expect(m[2]).toBe(m[1]);
  });
});
