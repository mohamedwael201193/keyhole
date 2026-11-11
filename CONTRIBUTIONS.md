# Contributions

Author and direction: **devmo** (`keyhole-devmo.near`). The work in this repository is AI-assisted under that direction.

The eligible window opens on 19 Oct 2026 ([HACKATHON.md](https://nearhackathon.com/HACKATHON.md) Q001). The first commit in this repository is [`7a8ec4a`](https://github.com/mohamedwael201193/keyhole/commit/7a8ec4a) on 27 Oct 2026. The v1 merge is [`66f7070`](https://github.com/mohamedwael201193/keyhole/commit/66f7070) on 28 Oct 2026. The diff between those two commits is [`7a8ec4a...66f7070`](https://github.com/mohamedwael201193/keyhole/compare/7a8ec4a...66f7070). Nothing in this repository is claimed as work from before that window.

## Original

The contract, worker, website, CLI and judge kit written in this repository are original work under devmo's direction. Their license is MIT ([LICENSE](LICENSE)).

## Imported

Imported code keeps the license published with that package. This repository does not relicense it.

| Surface | Role here | Where the license lives |
|---|---|---|
| `near-sdk`, `near-contract-standards` | Contract runtime and NFT standards | The crate that [`contracts/keys/Cargo.toml`](contracts/keys/Cargo.toml) names |
| `@near-wallet-selector/*` and the wallet modules | Connect a wallet in the browser | Each package named in [`web/package.json`](web/package.json) |
| NEAR Intents 1Click | Quotes. This repo does not vendor a replacement client | The upstream service. The web names `ONECLICK_API_KEY` and the worker names `ONECLICK_JWT`. Values are not printed here |
| CLI packages (`zod`, `@noble/*`, the MCP SDK) | Local signing and the MCP server | [`cli/package.json`](cli/package.json) |

This file is a disclosure of authorship and timing. It is not a submission.
