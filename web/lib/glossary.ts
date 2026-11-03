/** Plain-English meanings for the jargon on the site. Short enough for a tooltip. */
export const GLOSSARY = {
  tdx: { word: "Intel TDX", plain: "A sealed compartment inside an Intel server chip. Code running there can't be read or changed by the server's owner, and the chip signs a report of exactly which code ran." },
  tee: { word: "TEE", plain: "Trusted Execution Environment: a hardware-sealed place to run code privately, with a signed report of what ran." },
  enclave: { word: "enclave", plain: "The sealed TEE compartment where KEYHOLE's code runs and keeps each key's account private." },
  attested: { word: "attested", plain: "Signed by the Intel chip as proof of which code ran, on which input, and what it answered." },
  nep413: { word: "NEP-413", plain: "NEAR's standard for signing a plain message with your wallet. It costs no gas and moves no funds." },
  eip191: { word: "EIP-191", plain: "MetaMask's standard way to sign a plain text message (personal_sign). It costs no gas and moves no funds." },
  outlayer: { word: "OutLayer", plain: "The NEAR service that runs KEYHOLE's code inside Intel TDX machines and publishes each call's attestation." },
  oneclick: { word: "1Click", plain: "NEAR Intents' swap service: you send funds to a one-time address and solvers deliver the other asset, on any supported chain." },
  codehash: { word: "code hash", plain: "A fingerprint (sha256) of the exact program. If one byte changes, the fingerprint changes, so matching it proves it is the same code." },
  intents: { word: "NEAR Intents", plain: "A NEAR system where you state what you want (for example, swap A for B) and competing solvers fill it." },
  chainsig: { word: "Chain Signatures", plain: "NEAR's MPC network signs transactions for other chains (like Ethereum) on behalf of a NEAR account, without one party holding the whole key." },
  callid: { word: "call id", plain: "The receipt number of one enclave run. Paste it into /verify to check that run yourself." },
} as const;
export type Term = keyof typeof GLOSSARY;
