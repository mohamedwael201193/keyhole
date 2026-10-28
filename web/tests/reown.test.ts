import { describe, expect, it } from "vitest";
import { reownProjectId } from "@/lib/ethereumWallets";

describe("Reown project id", () => {
  it("hides WalletConnect when the env value is missing or blank", () => {
    expect(reownProjectId(undefined)).toBeNull();
    expect(reownProjectId("")).toBeNull();
    expect(reownProjectId("   ")).toBeNull();
  });
  it("keeps a real project id", () => {
    expect(reownProjectId(" abc ")).toBe("abc");
  });
});
