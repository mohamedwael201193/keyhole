"use client";
/**
 * Google / email sign-in through Privy, wired the way NEAR's Privy tutorial ("Direct Privy") and
 * near-examples/hello-privy do it: PrivyProvider + useLogin, pick (or create) the user's NEAR wallet,
 * and sign with a near-api-js Signer backed by Privy's signRawHash (in-page, no wallet popup).
 * Loaded on demand only (after the user picks Google / email, or when a Privy login is being restored).
 */
import { useEffect, useRef } from "react";
import { PrivyProvider, useLogin, useLogout, usePrivy } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { JsonRpcProvider } from "near-api-js";
import { RPC_URL } from "./config";
import { PrivySigner } from "./privySigner";
import { PRIVY_APP_ID, PRIVY_CLIENT_ID, type PrivyNear } from "./privy";

const provider = new JsonRpcProvider({ url: RPC_URL });

function Bridge({ wantLogin, method, onChange }: { wantLogin: number; method: "email" | null; onChange: (v: PrivyNear) => void }) {
  const { ready, authenticated, user } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
  const { signRawHash } = useSignRawHash();
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  const asked = useRef(0);

  useEffect(() => {
    if (!ready) return;
    // Google keeps the default modal; the email card opens the same modal limited to the email method.
    if (!authenticated && wantLogin && asked.current !== wantLogin) { asked.current = wantLogin; login(method === "email" ? { loginMethods: ["email"] } : undefined); }
  }, [ready, authenticated, wantLogin, method, login]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated || !user) { onChange({ ready: true, accountId: null, creating: false, signer: null, logout }); return; }
    // Pick the NEAR wallet explicitly (a user may also have an EVM wallet); create one if missing.
    const w = user.linkedAccounts.find((a) => a.type === "wallet" && "chainType" in a && a.chainType === "near");
    if (!w || w.type !== "wallet") {
      onChange({ ready: true, accountId: null, creating: true, signer: null, logout });
      if (!creating.current) {
        creating.current = true;
        createWallet({ chainType: "near" }).catch((e) => console.error("Could not create NEAR wallet", e)).finally(() => { creating.current = false; });
      }
      return;
    }
    onChange({ ready: true, accountId: w.address, creating: false, signer: new PrivySigner(signRawHash as never, w.address, provider), logout });
  }, [ready, authenticated, user, createWallet, signRawHash, logout, onChange]);
  return null;
}

export default function PrivyBridge(props: { wantLogin: number; method: "email" | null; onChange: (v: PrivyNear) => void }) {
  return (
    <PrivyProvider appId={PRIVY_APP_ID} clientId={PRIVY_CLIENT_ID || undefined}
      config={{ appearance: { accentColor: "#1F4B4F", theme: "light", showWalletLoginFirst: false, landingHeader: "Sign in to KEYHOLE" }, loginMethods: ["google", "email"] }}>
      <Bridge {...props} />
    </PrivyProvider>
  );
}
