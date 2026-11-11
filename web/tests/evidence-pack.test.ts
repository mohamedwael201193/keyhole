import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONTRACT_CODE_HASH, CONTRACT_WASM_SHA256 } from "@/lib/config";
import { IDENTITY } from "@/lib/identity.gen";

const b58 = (buf: Buffer) => {
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + buf.toString("hex")), s = "";
  while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; }
  return s;
};

/** The live evidence pack compares mainnet code_hash to this constant. It must be the v2.7 release wasm. */
describe("live evidence pack vs release wasm", () => {
  it("identity, the generated pack constant and contracts/keys/release/v2.7 are the same code", () => {
    const release = readFileSync(new URL("../../contracts/keys/release/v2.7/keyhole_keys.wasm", import.meta.url));
    const deployed = readFileSync(new URL("../../contracts/keys/deployed/keyhole_keys.wasm", import.meta.url));
    const sha = createHash("sha256").update(release).digest("hex");
    const hash = b58(createHash("sha256").update(release).digest());
    expect(sha).toBe("26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c");
    expect(hash).toBe("3cZsaySYgqZntFaRKEUffQUMGqRjkQ2DuSmFWXwiKGZH");
    expect(createHash("sha256").update(deployed).digest("hex")).toBe(sha);
    expect(CONTRACT_CODE_HASH).toBe(hash);
    expect(CONTRACT_WASM_SHA256).toBe(sha);
    expect(IDENTITY.contract.code_hash).toBe(hash);
    expect(IDENTITY.contract.wasm_sha256).toBe(sha);
    expect(IDENTITY.contract.deploy_tx).toBe("6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h");
    expect(IDENTITY.contract.version).toBe("2.7.0");
    const disk = JSON.parse(readFileSync(new URL("../../identity.json", import.meta.url), "utf8"));
    expect(disk.contract).toEqual(IDENTITY.contract);
    expect(hash).not.toBe("6hk2duibNShFzCpBchJaJM7DMpzBT4Jgt99e7pxpBoww");
  });
});
