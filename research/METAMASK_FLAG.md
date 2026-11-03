# Why MetaMask says "Malicious site" on keyhole-seven.vercel.app

Measured 2026-11-03 19:24 Cairo (UTC+2) from the box, with plain `curl` and no wallet. Nothing was submitted to any outside party.

## Short answer

The flag comes from **MetaMask's dapp-scanning service** (domain scanning by MetaMask's security partner, Blockaid). It does **not** come from the `eth-phishing-detect` list, and our signature payload does not cause it. The scanner gives the same `DRAINER / CRITICAL` verdict to **every subdomain we tried on shared free hosting**: `*.vercel.app`, `*.netlify.app`, `*.onrender.com`, `*.pages.dev` and `*.github.io`. That includes long-standing open-source sites and made-up names that have never been deployed. In other words it is a hosting-suffix reputation rule, not something about KEYHOLE.

## Evidence

### 1. The scanner verdict (this is what the extension calls)

```
GET https://dapp-scanning.api.cx.metamask.io/v2/scan?url=keyhole-seven.vercel.app
{"hostname":"keyhole-seven.vercel.app","recommendedAction":"BLOCK"}

GET https://dapp-scanning.api.cx.metamask.io/scan?url=https://keyhole-seven.vercel.app
{"domainName":"keyhole-seven.vercel.app","recommendedAction":"BLOCK",
 "riskFactors":[{"type":"DRAINER","severity":"CRITICAL","message":"Domain identified as a wallet drainer."}],
 "verified":false,"status":"COMPLETE"}
```

### 2. Controls (same endpoint, same minute)

| Host | Verdict |
|---|---|
| google.com, nextjs.org, vercel.app (apex), near.org, app.near-intents.org, ui.shadcn.com, keyhole.xyz | NONE |
| keyhole-seven.vercel.app (ours) | BLOCK, DRAINER |
| keyhole-mohamedwael201193s-projects.vercel.app, keyhole-git-main-… (ours, other aliases) | BLOCK, DRAINER |
| nextra.vercel.app, react-tweet.vercel.app (long-standing open-source docs sites) | BLOCK, DRAINER |
| my-totally-random-app-8812.vercel.app (never deployed) | BLOCK, DRAINER |
| zzq-unused-77.netlify.app / .onrender.com / .pages.dev / .github.io (never deployed) | BLOCK, DRAINER |

A name that has never served a single byte gets the same "wallet drainer" verdict as ours. So the verdict cannot depend on our content, our transactions or our signature requests.

### 3. Not on the public phishing lists

- `MetaMask/eth-phishing-detect` `src/config.json` (fetched 19:24): 115,573 blacklist entries, 59 whitelist, 8 fuzzylist. There are **0** entries containing `keyhole`, and neither `vercel.app` nor `keyhole-seven.vercel.app` is listed. The fuzzylist (cryptokitties.co, etherscan.io, launchpad.ethereum.org, makerfoundation.com, metamask.io, myetherwallet.com, opensea.io, satoshilabs.com) is not close to "keyhole-seven".
- Hosted stalelist `https://phishing-detection.api.cx.metamask.io/v1/stalelist`: 113,398 blocklist entries. It has 2,003 other `*.vercel.app` hosts but **0** containing `keyhole`.

### 4. The signature payload is not the trigger

- With MetaMask, the vault asks for `personal_sign` (EIP-191) over plain UTF-8 JSON: `{op, account_id, ts_ms, params, nonce, recipient:"keyhole"}` (`web/lib/nep413.ts` `intentMessage`). It is not `eth_signTypedData` and not a Permit/Permit2. It has no token approval, no `eth_sendTransaction` and no contract call. The only on-chain action MetaMask ever sees from us is a deposit, which the user starts on purpose.
- The "Malicious site" banner is a site-level trust signal. MetaMask shows it on connect and repeats it on every request from a host that is marked BLOCK, whatever the request contains (see MetaMask's "Security alerts" help page, which lists website alerts separately from transaction simulation).

## What fixes it

1. **Serve the app from a custom domain.** Apex and custom domains we tested scan as NONE. This needs a domain purchase and a Vercel domain setup, which is the owner's decision; nothing has been bought.
2. **File a false-positive report** (owner's decision, not filed). Reports go to MetaMask's repo using the removal template:
   - https://github.com/MetaMask/eth-phishing-detect/issues/new?template=02-blocklist-removal.yaml
   - Blockaid, which powers the scan: https://report.blockaid.io/

   Because the rule hits the whole hosting suffix, a removal request for one `*.vercel.app` host may not be granted, or may not hold. A custom domain is the durable fix.
3. **In the app now (no purchase needed):** the vault and mint pages say why the warning appears and point judges to the wallet-less path (`/verify`, `/judge`) and to NEAR wallets, which do not use this scanner.

## Reproduce

```
curl -s "https://dapp-scanning.api.cx.metamask.io/scan?url=https://keyhole-seven.vercel.app"
curl -s "https://dapp-scanning.api.cx.metamask.io/scan?url=https://my-totally-random-app-8812.vercel.app"
curl -s "https://dapp-scanning.api.cx.metamask.io/scan?url=https://google.com"
curl -s https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json | grep -c keyhole   # 0
```
