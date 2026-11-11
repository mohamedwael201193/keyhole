import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("judge/live.mts refuses to load a wallet unless opted in", () => {
  const src = readFileSync(new URL("./live.mts", import.meta.url), "utf8");
  const guard = src.indexOf("KEYHOLE_LIVE_OPT_IN");
  const load = src.indexOf("loadKey(");
  assert.ok(guard >= 0 && load > guard);
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", "judge/live.mts"], {
    encoding: "utf8",
    timeout: 20_000,
    env: { ...process.env, KEYHOLE_LIVE_OPT_IN: "" },
  });
  assert.equal(r.status, 2);
  assert.match(`${r.stderr}${r.stdout}`, /KEYHOLE_LIVE_OPT_IN/);
});
