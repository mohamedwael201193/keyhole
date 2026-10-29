# KEYHOLE web

Live: **https://keyhole-seven.vercel.app** (NEAR mainnet only)

![Home](screenshots/desktop-home.webp)

| Page | What it does | Real source |
|---|---|---|
| `/` | Hero, three steps, proof table | `nft_total_supply`, `config` views on `keyhole-devmo.near` (revalidated every 30 s) |
| `/atlas` | Chain marks, each one with its trail | NearBlocks tx links and OutLayer attestations. Marks without a trail are labeled "No trail yet" |
| `/vault` | After connect: fund (deposit address), trade (quote, then Sign & trade), withdraw to the connected account, plus limits, balance and history | TEE worker ops `status`, `account`, `quote`, `swap`, `withdraw`, `balance`, `history` |
| `/mint` | Tier table and one-signature mint | TEE worker op `mint`. The TEE-held minter signs `nft_mint` |
| `/gallery` | Every key on mainnet, drawn from contract state | `nft_tokens`, `nft_tier` |
| `/verify` | Paste a call id to check it | OutLayer attestation plus the FastFS wasm, hashed in your browser |

## How a request flows

1. Your wallet signs a NEP-413 message (`signMessage`). There is no transaction and no gas.
   - `message = JSON.stringify({op, account_id, ts_ms, params})`
   - `recipient = "keyhole"`
   - `nonce` = 32 fresh random bytes
   - Source: [`lib/nep413.ts`](lib/nep413.ts).
2. The browser sends `{op, auth}` to `/api/keyhole`, which is the same handler as `/api/worker`. The route:
   - allows `info|status|quote|mint|account|balance|history|swap|withdraw`;
   - relays `swap` and `withdraw` only when the body has a NEP-413 `auth` whose message `op` matches. The TEE checks the signature, the nonce, the tier caps and the rate limit. The vault sets the withdraw destination to the connected account. Unsigned and junk auth are `no_auth`;
   - refuses `copy` and `sweep_minter` with `bad_op`. `copy` stays on the CLI and MCP;
   - rejects bodies over 8 KB;
   - limits each IP to 20 calls per minute;
   - adds the OutLayer payment key from a server-only env secret, then forwards the call;
   - never logs bodies, amounts or accounts.
3. The worker runs in Intel TDX. It verifies:
   - the ed25519 signature and the full-access key on-chain;
   - the 5-minute window;
   - the replay store;
   - your tier from the NFT;
   - your caps.
4. Every result shows its call id, an attestation link and a **verify** link.

The CLI can use this site as its gateway: `KEYHOLE_GATEWAY=https://keyhole-seven.vercel.app/api/keyhole keyhole status`.

## Verify without trusting this site

`/verify?call=<id>` runs the same three checks as `../verify.sh`:

1. An Intel TDX quote is present.
2. The registered `wasm_hash` equals `executed_wasm_sha256`.
3. `sha256` of the wasm bytes on FastFS equals the executed hash. Your browser computes this with `crypto.subtle`.

![Verify](screenshots/desktop-verify.webp)

## Keys are drawn from chain state

The state of each key comes from on-chain data and the connected viewer:

| State | Rule |
|---|---|
| `legendary` | tier 3. It is reserved, and no tier-3 key exists. |
| `expired` | `metadata.expires_at` is in the past |
| `unlocked` | the connected account owns the token |
| `locked` | any other viewer |

The rule lives in [`lib/near.ts`](lib/near.ts) and is unit-tested.

![Keys](screenshots/desktop-gallery.webp)

## Wallets, languages, access

- **Wallets:** a NEAR wallet (NEP-413 `signMessage`) or MetaMask (EIP-191 `personal_sign`). The published enclave checks both.
  - The wallet bundle loads when you click Connect, or when this browser has connected before.
  - A redirect wallet resumes the signed request after it returns.
- **Language:** English only. Copy lives in `messages/en.json`.
  - There is no language switcher and no RTL layout.
  - `/ar` and `/ar/...` redirect to the same English path.
  - Each worker and gateway error code maps to a short English message and a fix, and a test checks this against the worker source.
- **Access:**
  - Works on mobile from 360 px.
  - Touch targets are at least 44 px.
  - There is a skip link and visible focus rings.
  - `prefers-reduced-motion` freezes the hero on its settled frame.
  - On touch devices the WebGL field draws one frame only.
- **Security headers:** CSP, HSTS, nosniff, a strict referrer policy and `frame-ancestors 'none'`.

![Mobile](screenshots/mobile-home.webp) ![Vault on mobile](screenshots/mobile-vault.webp)

## Design and motion

- **Hero:** a 9-second entrance.
  - The headline rises in.
  - The relic turns in from −28° while an aperture mask opens.
  - A beam runs to the vault card.
  - Eight official chain marks fly in and orbit. ETH and Base sit on light discs so their marks stay visible.
- **Field:** a single fullscreen-triangle WebGL shader (`ogl`).
  - It loads after the `load` event plus 2.5 s.
  - It reacts to the cursor, with the key moving more than the ring.
  - Its brightness is capped, and it never crosses the solid text plate.
- **Music:** an optional ambient loop, off by default. It starts only when you click.
  - The track was generated procedurally for this project and is released under CC0. See `public/audio/LICENSE.txt`.
- **Brand:** swap the files in `public/brand/` to rebrand.

## Run, test, deploy

```bash
npm ci
OUTLAYER_PAYMENT_KEY=... npm run dev     # the key is only needed for /api/keyhole
npm run lint && npm run typecheck && npm test && npm run build
npx playwright install chromium && BASE_URL=https://keyhole-seven.vercel.app npm run e2e
```

Signed calls through the gateway are made with the browser's own signing code: `KEYFILE=key.json BASE=... npx tsx scripts/signed-call.mts status '{}'`
