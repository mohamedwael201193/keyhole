import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("judge/live.mts refuses to load a wallet unless opted in", () => {
  const src = readFileSync(new URL("./live.mts", import.meta.url), "utf8");
  const gate = src.indexOf("./live-gate.mjs");
  const load = src.indexOf("loadKey(");
  assert.ok(gate >= 0 && load > gate);
  const r = spawnSync(process.execPath, ["judge/live-gate.mjs"], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, KEYHOLE_LIVE_OPT_IN: "" },
  });
  assert.equal(r.status, 2);
  assert.match(`${r.stderr}${r.stdout}`, /KEYHOLE_LIVE_OPT_IN/);
});
