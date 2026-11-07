# Token icon sources

Icons used by `components/TokenIcon.tsx`. The asset-to-icon map is in `lib/tokenIcons.ts`.

| File | Mark | Source | Licence |
|---|---|---|---|
| near.svg | NEAR (also used for wNEAR) | Copied unchanged from `web/public/logos/near.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| usdc.svg | USDC | Copied unchanged from `web/public/logos/usdc.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| eth.svg | ETH | Copied unchanged from `web/public/logos/eth.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| sol.svg | SOL | Copied unchanged from `web/public/logos/sol.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| btc.svg | BTC | Copied unchanged from `web/public/logos/btc.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| base.svg | Base | Copied unchanged from `web/public/logos/base.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| arb.svg | Arbitrum | Copied unchanged from `web/public/logos/arb.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| zec.svg | Zcash | Copied unchanged from `web/public/logos/zec.svg`, already in the repo | Not recorded in the repo; the mark belongs to its owner |
| usdt.png | USDT (Ethereum contract 0xdAC17F958D2ee523a2206206994597C13D831ec7) | https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png, fetched 2026-11-07, 300 x 300 PNG, unmodified | Repository MIT (Copyright 2019-2023 Trust Wallet, https://github.com/trustwallet/assets/blob/master/LICENSE). The logo is Tether's trademark |

Fallback: when an asset has no mark, or the file fails to load, `TokenIcon` draws a monogram from the symbol (no network request).

Before a public launch, confirm the licence for the `/logos` marks and replace any mark that cannot be cleared.
