# Frontend requirements (global, production)

The web app must work for any NEAR user worldwide. These come from the worker/contract design and must be met by the site build.

## Wallets
- Use NEAR Wallet Selector (`@near-wallet-selector/*`) with the major NEAR wallets: MyNearWallet, Meteor, HERE, Intear, Sender, Nightly, Ledger, plus WalletConnect for mobile.
- Require `signMessage` (NEP-413). If the chosen wallet lacks it, say so clearly and suggest one that has it.
- Sign: `message = JSON.stringify({op, account_id, ts_ms: Date.now(), params})`, `recipient = "keyhole"`, `nonce = 32 random bytes` (crypto.getRandomValues). Fresh nonce on every request; never reuse.
- Named and implicit (64-hex) accounts must both display well (truncate the middle of hex ids).

## Calls
- The browser never holds the OutLayer payment key. Requests go through a server route (Vercel function) that adds `X-Payment-Key` and forwards `{op, auth}` to the worker.
- Server route: per-IP rate limit, body size limit (≤ 8 KB), allow only ops `info|status|quote|mint`, no logging of request bodies or amounts.
- Show the attestation link (`/attestations/by-call/<call_id>`) on every result, and the build hash.

## Errors
- Map every worker `error.code` to a short human message plus a fix (e.g. `expired` → "Your clock may be off; sign again"; `over_cap_per_tx` → show the cap and the tier upgrade path; `rate_limited` → countdown).
- Never show raw upstream text as the primary message.

## i18n
- All strings in message catalogs (e.g. next-intl). English is the default. Plan Arabic (RTL), Spanish, Chinese, Portuguese, Turkish, Russian, Hindi, Indonesian, Vietnamese, Korean.
- RTL layout support (logical CSS properties).
- Locale-aware number, currency (USD caps shown as USD) and date formats; times in the user's local zone and the "UTC day" for daily caps explained.

## Mobile and access
- Mobile-first, works at 360 px width, touch targets ≥ 44 px.
- Deep links / WalletConnect for mobile wallets.
- WCAG 2.2 AA: contrast, keyboard navigation, focus rings, `prefers-reduced-motion` turns off heavy animation.
- Fast: LCP < 2.5 s on 4G, lazy-load 3D/motion, static pages where possible.

## Onboarding
- Three steps only: Connect, Mint key (one signature), Open account.
- No sign-up, no email, no KYC fields, no region checks.
- Explain gas-free signing in one line. Show the limits table for each tier before the first action.

## Gaps to close (not built yet)
- Per-holder confidential balances. The worker today quotes into the holder's own addresses (non-custodial). Holder-owned TEE accounts (one OutLayer wallet per holder) are a later step.
- Tier upgrades (Silver/Gold) and paid mint flow.
- OutLayer Policy Engine on the shared wallet as a second layer of caps.
- Public status page for 1Click/OutLayer availability.
