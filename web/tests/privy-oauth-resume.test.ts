import { describe, expect, it } from "vitest";
import { privyResume, stripPrivyOauth, hasPrivyOauth } from "@/lib/privy";
import { readFileSync } from "node:fs";

describe("Privy OAuth callback mounts Privy on load", () => {
  const cb = "?privy_oauth_state=s&privy_oauth_provider=google&privy_oauth_code=c";
  it("query params from Google redirect -> oauth (mount + 'Finishing Google sign-in')", () => {
    expect(hasPrivyOauth(cb)).toBe(true);
    expect(privyResume(cb, [])).toBe("oauth");
  });
  it("our flag or Privy's own local state -> restore", () => {
    expect(privyResume("", ["kh_privy"])).toBe("restore");
    expect(privyResume("", ["privy:token"])).toBe("restore");
    expect(privyResume("?x=1", ["near-wallet-selector:selectedWalletId"])).toBeNull();
  });
  it("strips only the privy_oauth_* params", () => {
    expect(stripPrivyOauth(`https://k.app/start${cb}&keep=1#h`)).toBe("/start?keep=1#h");
    expect(stripPrivyOauth(`https://k.app/start${cb}`)).toBe("/start");
  });
  it("WalletProvider mounts the Privy bridge from privyResume on load", () => {
    const w = readFileSync(new URL("../lib/wallet.tsx", import.meta.url), "utf8");
    expect(w).toMatch(/privyResume\(location\.search, Object\.keys\(localStorage\)\)/);
    expect(w).toMatch(/if \(resume\) \{ setRestoring\(true\); setPrivyOn\(true\)/);
  });
});
