# KEYHOLE — live identities, governance, build history

Generated from [`identity.json`](../identity.json) and live mainnet reads. Do not edit the
live values by hand — re-read them from the chain (commands below). This page holds the
tables the README used to carry; the README keeps only the current live values.

## Live identities

| Piece | Live value | Proof |
|---|---|---|
| Contract account | `keyhole-devmo.near` | [nearblocks](https://nearblocks.io/address/keyhole-devmo.near) |
| Contract version | `2.7.0` | NEP-330 `contract_source_metadata` |
| Contract code hash | `3cZsaySYgqZntFaRKEUffQUMGqRjkQ2DuSmFWXwiKGZH` | deploy tx [`6rD2iMs1…`](https://nearblocks.io/txns/6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h) |
| Contract wasm sha256 | `26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c` (519,382 bytes) | [`contracts/keys/release/v2.7/keyhole_keys.wasm`](../contracts/keys/release/v2.7/keyhole_keys.wasm) |
| TEE minter | `015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443` | `verify/0-live.sh` requires `config.minter` to equal this 64-hex implicit account |
| Worker project | `keyhole-devmo.near/keyhole` | |
| Worker wasm sha256 | `5c7866666010068e77652d21265df9b0d6fc30b934627be5af53194be8743231` (1,382,841 bytes) | [`tee/worker/DEPLOYED_SHA256`](../tee/worker/DEPLOYED_SHA256) |
| Worker publish tx | `Mi9fYL9UdYQSRXEQzii1LS37vsBCJbP4bPtwNsHaqWU` | [nearblocks](https://nearblocks.io/txns/Mi9fYL9UdYQSRXEQzii1LS37vsBCJbP4bPtwNsHaqWU) |
| Live `info` call | `91b0e9a9-219b-46ec-a174-1f74e2f24b85` | [attestation](https://api.outlayer.ai/attestations/by-call/91b0e9a9-219b-46ec-a174-1f74e2f24b85) · [verify](https://www.getkeyhole.xyz/verify?call=91b0e9a9-219b-46ec-a174-1f74e2f24b85) |
| Treasury | `keyhole-devmo.near` | `config` |
| Royalty | 500 bps (cap 1000) | `config` |

<!-- TODO(R8): once worker r8 is live and the probe passes, re-pin every 5c786666
reference in README.md and this file to the r8 hash, and replace the info call above
with a fresh info call on r8 (91b0e9a9… is on 5c786666). -->

## Governance (live `governance_state`, read 2026-11-14)

| Field | Value |
|---|---|
| Owner | `0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228` (guardian implicit account; the contract account no longer owns the contract) |
| Pending owner | `ee91dcebd2e4061271a149abcc8ef2c6be8b9696c928348b52cb3f5204645f67` (lock account) |
| `pending_owner_not_before_ns` | `1794610539900007445` (2026-11-13 22:55:39.9 UTC — elapsed) |
| Staged upgrade | `null` (no staged upgrade) |
| `min_upgrade_delay_ns` | `86400000000000` (24 h) |
| `wind_down_ns` | `1801440000000000000` |
| `wound_down` | `false` |
| Lending | off (`lending_enabled: false`) |

Access keys on `keyhole-devmo.near` (live `view_access_key_list`, read 2026-11-14):

| Key | Permission |
|---|---|
| `ed25519:7N1fLo9MssKJoiL3kqBHX1zhmqjPxyDuzG5Fk583mxzF` | FullAccess |
| `ed25519:8NP9x5eFZic4E8cL4Pq8NLoHwB5VG1tbhWPnHSPE2bdj` | FullAccess |
| `ed25519:FNe2aYtzNZ3FicPYdCjxgWuVMTf29NK2F1UzoFSsQ6h1` | FunctionCall (allowance 1 NEAR; methods `__fastdata_kv`, `__fastdata_fastfs`; receiver `social`) |

The lock deletes all three keys (D1–D3) after `accept_owner` moves ownership to the
lock account. Verify with `view_access_key_list` — see the README's Lock section.

## Keys on the contract (supply 9, live `nft_total_supply`, read 2026-11-14)

Eight keys are tier 1; `k5f4750858f328940` is tier 2 after `level_up`. Token `0` is a
test key held by the contract account. The four tokens minted before the build that
writes `media` (`0`, `k0642e7964b2fb515`, `k5f4750858f328940`, `k857b6b68facc0f94`)
have `media: null` on chain; newer mints write `media` and its hash into the token.

| token | holder | tier | mint tx |
|---|---|---|---|
| `0` (test key) | `keyhole-devmo.near` | 1 | [`UYHismxe…`](https://nearblocks.io/txns/UYHismxe3a2Xb5YvbVHuGhsHWf7ERrx5oCrxREePBFR) |
| `k857b6b68facc0f94` | `a7458a83…91da` | 1 | [`FaYzSUYT…`](https://nearblocks.io/txns/FaYzSUYTzoG3udAE3d31sUwWFeskndkhrZ8iehk1NxJ4) (first TEE minter) |
| `k5f4750858f328940` | `456dbde9…e2a0c` (buyer of the NEP-178 sale) | 2 | [`DJxbuaJV…`](https://nearblocks.io/txns/DJxbuaJVAhwBrK9xne1t623XuL8dMSm8So3eEVtZpHgF) (current minter) |
| `k0642e7964b2fb515` | `476abdb5…8c8` | 1 | enclave mint, call [`9e62569d`](https://api.outlayer.ai/attestations/by-call/9e62569d-9444-4503-8bf2-4c1c266b8316) |
| `k102a806df6867547` | `0xf76e6b09…71a3` (MetaMask, EIP-191) | 1 | enclave mint from a MetaMask account; carries `media` on-chain |
| `k22b07f20ff167d8d` | `a838e946…92f4` | 1 | `media` is set on chain |
| `k4f29a567a21b2177` | `4c7143d8…` | 1 | <!-- TODO: mint tx once confirmed --> |
| `ka6ad6993999b8fee` | `0c086e09…` | 1 | <!-- TODO: mint tx once confirmed --> |
| `k88bf49da96212902` | `583a3a56…569b` (fresh borrower B2) | 1 | [`27zmxP3b…`](https://nearblocks.io/txns/27zmxP3bEJfMvgRKFf3Wt7hDLc8AiRGJLoiSetTgboCV) (loan token) |

Note: older mint metadata uses the phrase "viewing key" ("Viewing key to a
confidential account"); the key is a control key. That wording is frozen on-chain
on the existing tokens and cannot be changed.

## Contract build history

| Version | Wasm sha256 (`release/`) | Code hash (base58) | Status |
|---|---|---|---|
| v1 | `d985104e128c598996932a1504cff26093277f4528ef513578af7386a29e817b` (195,389 bytes) | `Fe79rQUHKXnjhuY4NCDYrv3twNKPw7YTmqK3yxjtqxYA` | previous |
| v2 | `a57123002dbc164bfd5684dc2a360d35c5681c4b4ab59172cb6c45b331a73ad2` (207,996 bytes) | `C8pL59r9NorJxcYXnXusZxz2cNaGEgiVbMnZPANivLc1` | previous |
| v2.1 | `57b63c36d782bb4e60c4a25e9cc238093bc909a328617be864ba6327191a30ac` (208,204 bytes) | `6uPe67SgsPuE71E73jp8zsbReQPGhTbW8UmUV5mjwtuh` | previous |
| v2.2 | `9e685c32bf5f57e0fda86f270e96f79723b54499a670306bb8f8bc0a68d5089e` (209,952 bytes) | `BfMiMAfgMzVYHRREaZr4QTfifwzbqR1wjGweH86xMLeZ` | previous |
| v2.3 | `700bd51fc1cd9bfb46b655f2c6c77632f2c6b6c3c53329dd2990ea36eb00e09d` (210,474 bytes) | `8YP8Mr2c8yCxtZU1xtio8K5Lk5YuPC7WPBzuGFS9WwLG` | previous release |
| v2.4 | `b5c30849079e18a4a6d13037e43f56952ca8a479bbf64848ce20d21b481a1e5c` (241,621 bytes) | `DEXHHyEMdFTdFQ32dYnj264RSj3QG2FSwCY5fbjzSiZZ` | superseded by v2.5 ([deploy](https://nearblocks.io/txns/84zVBikU5JrAAnyaXTHQWwQSuq15zgLmMFJZsVnJZsPn)) |
| v2.5 | `28cbe755268145d1e675106c8b9834e2c2b05baafccd3296e894072ecdaa25ce` (485,855 bytes) | `3kFeCRQMfBweSDsL72DrggEeJJ6v9DLw2xSn7T6zqK3b` | superseded ([deploy](https://nearblocks.io/txns/BRuwESG8Baosp3txJWRdSHW1jXr9w4RgVURqZ2q2ou5S)) |
| v2.6 | `54ba51b3d7d256820e751c9fa4e0cda55c66b30111a186c6d9eff03b561b7b8a` (487,260 bytes) | `6hk2duibNShFzCpBchJaJM7DMpzBT4Jgt99e7pxpBoww` | historical ([deploy](https://nearblocks.io/txns/4XrNsFhgRrapQii14PYYc215cVEzZ8wubs3fytM3YAPj)) |
| **v2.7** | `26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c` (519,382 bytes) | **`3cZsaySYgqZntFaRKEUffQUMGqRjkQ2DuSmFWXwiKGZH`** | **live** ([deploy](https://nearblocks.io/txns/6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h)) |

v2.7 is a code-only deploy. No `new`, `migrate` or `migrate_pledge`. Versus v2.6 the
code-storage delta is 32,122 bytes (0.32122 NEAR). Handover is `propose_owner`, then
`accept_owner` after 24 h; `accept_owner` clears a staged upgrade, so
`apply_upgrade` runs first. Governance writes are refused in the same receipt when
they would spend listing bonds, user liabilities, treasury, a pending recovery or the
operating reserve. Limits: [SECURITY.md](../SECURITY.md#v27-contract-limits).

## Worker build history (every `add_version`, with its live `info` call)

| Build | Role | `add_version` tx | Live `info` call |
|---|---|---|---|
| `5c786666` (1,382,841 bytes) | current | [`Mi9fYL9U…`](https://nearblocks.io/txns/Mi9fYL9UdYQSRXEQzii1LS37vsBCJbP4bPtwNsHaqWU) | [`91b0e9a9`](https://api.outlayer.ai/attestations/by-call/91b0e9a9-219b-46ec-a174-1f74e2f24b85) |
| `e9e570e5` (1,382,833 bytes) | previous | [`4ueDpiq5…`](https://nearblocks.io/txns/4ueDpiq5jm6VXMjr96X1f3UVGWeAKNA2fLsosxWuG43t) | [`c8db49d3`](https://api.outlayer.ai/attestations/by-call/c8db49d3-900a-49d7-b7ae-5012579a00ff) |
| `0d645930` (1,379,425 bytes) | previous | [`7TMAjPuW…`](https://nearblocks.io/txns/7TMAjPuWT1auMme1VYqfjMLwJphgcMucj8g4ig4gvE1T) | [`2220caa1`](https://api.outlayer.ai/attestations/by-call/2220caa1-90ad-42a6-b281-cfd08cd1b354) |
| `1992b736` (1,383,708 bytes) | removed | add [`HPzsQa4r…`](https://nearblocks.io/txns/HPzsQa4r6Ey6maeFJ9SnYJadqAFR2NuvdnaeSDuFkcJR) 21:43:46 UTC Nov 13 (set active) · set inactive [`HHN5SC6U…`](https://nearblocks.io/txns/HHN5SC6UGifXQJCbQ6GcC72mH7AaPYyxxCJoJB2Wcyck) 22:24:51 UTC (41 min active) · remove [`C4mjHMwU…`](https://nearblocks.io/txns/C4mjHMwURnRPC5JTN7jegEj3zBSqhKrMcs6CgDnxY6kC) 23:09:45 UTC | — |
| `119e920d` (1,370,784 bytes) | previous | [`6tTmKphg…`](https://nearblocks.io/txns/6tTmKphgDz4FG3WxP8gwN4w8cRaJu2QCXcBzGBhu59ie) | [`41ace198`](https://api.outlayer.ai/attestations/by-call/41ace198-a27a-462b-a9a3-b4f93be75c2d) |
| `47024200` (1,365,265 bytes) | previous | [`AtETZ9Fd…`](https://nearblocks.io/txns/AtETZ9FdMMUtmWhY16pRCvGgu5efSvUsXWvMGHNyQNiH) | [`4f1133c4`](https://api.outlayer.ai/attestations/by-call/4f1133c4-7925-45a5-87cb-0dfeac3df183) |
| `9e56a212` (1,365,082 bytes) | previous | [`7fRT8Uee…`](https://nearblocks.io/txns/7fRT8UeeDwwfrEs2qpsYDuHrcufUmCHwcdDnZ7vF54xk) | [`5dc50687`](https://api.outlayer.ai/attestations/by-call/5dc50687-1c19-4785-997b-29f8fdda3bcf) |
| `ed0f614a` (1,353,458 bytes) | previous | [`GXZtL6hg…`](https://nearblocks.io/txns/GXZtL6hgscWUAh7SpZLA5SBLyrVe4w9bCxz2Kmb4q1K5) | [`ed2c7a62`](https://api.outlayer.ai/attestations/by-call/ed2c7a62-411f-4f8f-b06d-b214898e0ec4) |
| `37628ea5` (1,350,050 bytes) | previous | [`B6GReQmb…`](https://nearblocks.io/txns/B6GReQmb817bqkPrWKoniKRZziWHYK4PZvH1A1u54MqJ) | [`116641a2`](https://api.outlayer.ai/attestations/by-call/116641a2-0744-45a0-9698-4b23dab365fc) |
| `de9e3005` (1,349,861 bytes) | previous | [`5TNWPKKL…`](https://nearblocks.io/txns/5TNWPKKL1XTGQRA5gJ2KsLugc7TFMv6cP17jiRJiW7Ue) | [`1810bf33`](https://api.outlayer.ai/attestations/by-call/1810bf33-2a8c-42c9-931a-f0ececc3a7d0) |
| `114dff5a` (1,349,199 bytes) | previous | [`9VNRDazN…`](https://nearblocks.io/txns/9VNRDazNv6dXJjkaybQ4bm1SiTrPvb11p3zycyTj8Hc2) | [`42f2c909`](https://api.outlayer.ai/attestations/by-call/42f2c909-27db-4562-9a24-a0399c0f9a1d) |
| `34bf835c` (1,340,205 bytes) | previous; no recorded `info` call | [`y9je7NLY…`](https://nearblocks.io/txns/y9je7NLYr7LnFLNjefkoa6XMSvFBJxmn7CV6SYa3aK5) | none recorded |
| `62398a8a` (1,085,333 bytes) | previous guarded singleton | [`3emr8M4R…`](https://nearblocks.io/txns/3emr8M4RZUapyGWynK5r3MhtAEA7R3SMzzdEEY4u8i9P) | [`962d4374`](https://api.outlayer.ai/attestations/by-call/962d4374-b9ec-411a-9efa-973b36260431) |
| `d337e822` (765,658 bytes) | previous; historical proofs only | [`BWQxEoSg…`](https://nearblocks.io/txns/BWQxEoSg3b6XHdk4iooAneoBJM7EtP83HTrvYXpdBQi5) | [`dc3668db`](https://api.outlayer.ai/attestations/by-call/dc3668db-674f-4865-a2ce-272f70c41b0d) |
| `cc8d2fa8` (755,751 bytes) | previous | [`Epaz3aMA…`](https://nearblocks.io/txns/Epaz3aMAk1WuLGaMuHKCACvGU981uEr4zUqzyep1zfi6) | [`0847b924`](https://api.outlayer.ai/attestations/by-call/0847b924-df76-4cee-ab5a-a96c789d2983) |
| `a985fd87` (745,180 bytes) | previous | [`A1o8882h…`](https://nearblocks.io/txns/A1o8882hpjZmBr56hhDop236MrSFtEnMfNt9nEZwo4sG) | [`246e4a7a`](https://api.outlayer.ai/attestations/by-call/246e4a7a-f138-4459-8548-350dd9960751) |
| `ebeb6a34` | previous, rolled back to `94c355ff` | [`MG7pGVSN…`](https://nearblocks.io/txns/MG7pGVSNjFDz85yqrAA9stN4yyXECYfYLDmCgYE4gyq) | [`5650a6b7`](https://api.outlayer.ai/attestations/by-call/5650a6b7-b7de-410c-b206-e189171bad15) |
| `94c355ff` | previous | [`EA7S1TeV…`](https://nearblocks.io/txns/EA7S1TeVnMF1v5FthV4ffQf9NYXfGJTtzo4ZRp25ZBjy) | [`ecb0d1d6`](https://api.outlayer.ai/attestations/by-call/ecb0d1d6-90e3-4522-852a-578ca50fdeb6) |
| `cff9fd3c` | previous | [`AepKgT8M…`](https://nearblocks.io/txns/AepKgT8M1XhMjWMHMzaJSo3YnBXzG58YYrLVyp8tUW3z) | [`643a012d`](https://api.outlayer.ai/attestations/by-call/643a012d-0389-44d7-9c78-efb5d7835e80) |
| `a55ebb14` | previous | [`GNqXiicF…`](https://nearblocks.io/txns/GNqXiicFgXQpS5LsYiNRffK6Xhp5W7Yi8EZK2XqKvX8X) | [`b0a6eadb`](https://api.outlayer.ai/attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec) |
| `09d481a5` | previous | [`F1XzcCcz…`](https://nearblocks.io/txns/F1XzcCczrnkGryZ4UuvmGQA1gFeW6U26KJEu9mne6ZQu) | [`2896d0ad`](https://api.outlayer.ai/attestations/by-call/2896d0ad-aa27-4e21-b4a1-0cf2d3755d56) |
| `f7217ae2` | previous | [`CcttLJdw…`](https://nearblocks.io/txns/CcttLJdwCa8EaLhY42fh6SBZbcVphtycrNTc74jnvkyW) | [`54207d9e`](https://api.outlayer.ai/attestations/by-call/54207d9e-b4f0-438b-9a74-cdba33de80d9) |
| `452df1fd` | previous | [`FXbXhGNi…`](https://nearblocks.io/txns/FXbXhGNirZCkiP2bx1aiBFQL3Q1EHFMpniJTY579oGWN) | [`7882f97a`](https://api.outlayer.ai/attestations/by-call/7882f97a-06e5-46d3-9e58-5fe6428fb187) |
| `6367401a` | previous | [`AJWVEN6F…`](https://nearblocks.io/txns/AJWVEN6FfQaE3ZE3V7KDHj1BtzCKTx3iMH3tx8CLYqKx) | [`f4768da8`](https://api.outlayer.ai/attestations/by-call/f4768da8-2e87-4622-8654-d1e67f6cd1f0) |
| `67c5cd77` | previous | [`86tCjm92…`](https://nearblocks.io/txns/86tCjm92yBqKoHt2kz99es1NadZeKf91AfUTx2uaqfmr) | [`0f0bf448`](https://api.outlayer.ai/attestations/by-call/0f0bf448-1b66-4200-b6de-7cf095aead54) |
| `38bd67b9` | previous | [`9pk1mDC1…`](https://nearblocks.io/txns/9pk1mDC1dxzTXE7H7mHLXVVckHMEmRA4VnfxfxAzdb2z) | [`763812bc`](https://api.outlayer.ai/attestations/by-call/763812bc-0012-4528-a45d-66a3ce17cae9) |
| `b3fa1a39` | previous | [`B3x8cU6G…`](https://nearblocks.io/txns/B3x8cU6GH25cPDxNZ56mP4fACRuqXUbopobeJxR11kCU) | [`9d19bceb`](https://api.outlayer.ai/attestations/by-call/9d19bceb-986b-4745-9bf9-91f7dcb62b6e) |
| `f13efe92` | previous (the 30-step E2E build) | [`22KDVU1s…`](https://nearblocks.io/txns/22KDVU1sNKQhjoYbN8h1JqyQbcNxHRNednT6sz4nogxS) | [`cefbc64e`](https://api.outlayer.ai/attestations/by-call/cefbc64e-6c08-4bfe-a165-1667d9f5f25b) |

The `1992b736` (r5) row is the recovery version: it added a read-only
`export_pending_minter_tx` op, was used once to recover the lost payout
(tx `J5dHg2q…`, rebroadcast via public RPC 22:44:57 UTC Nov 13), and was
removed the same night because guarded operations require a singleton registry.
Its wasm and source are preserved and it can be re-added only before the lock,
using the recovery pattern in `exec/loans/EXPORT_OP_CALL_RUNBOOK.md`.

The worker sha256 identifies KEYHOLE code; the TDX measurement names the
OutLayer runtime. Published code is not proof that lending or a provider policy
pilot is enabled: lending stays off.

## Provisioning (R4) and the guarded worker

The published guarded worker prepares its provider policy inside the enclave,
quotes storage with the minter refund beneficiary, and submits collateral with
the enclave-only minter. A pinned, signed authority review in this repository
binds the wallet, policy, build and owner epoch it names. The sealed eligibility
writer runs only after the original registration is FINAL and the immutable
binding matches.

- [R4 release lifecycle and finding map](evidence/worker-provisioning/R4.md)
- [Production path and runnable proof](evidence/worker-provisioning/README.md)
- [Reproducible candidate identity](evidence/worker-provisioning/candidate.json)
- [Storage, route and bounded compute accounting](evidence/worker-provisioning/RESEARCH.md)
- [Candidate validation (V2 source candidate)](evidence/worker-provisioning/v2/r3/validation.json)

Build: `cd tee/worker && ./build.sh` (rustc 1.99.1 from `rust-toolchain.toml`,
`cargo --locked`, `--remap-path-prefix`, `SOURCE_DATE_EPOCH=0`) reproduces the
source candidate; `node scripts/check-worker-candidate.mjs` compares this
checkout with the candidate bytes. The worker source candidate is an unpublished
candidate unless its hash matches the published `5c786666…` above.

## Test counts (pinned review commit; re-verified at PR time)

| Component | Count | How it was measured |
|---|---|---|
| Keys contract unit tests | **342** pass | `cd contracts/keys && cargo test --locked` |
| Keys contract sandbox tests | **62** pass, 1 opt-in ignored | full local suite |
| TEE worker unit tests | **758** pass | `cd tee/worker && cargo test --locked` |
| CLI tests | **81** pass | `cd cli && npm test` |
| Web unit tests (Vitest) | **2032** pass in 124 files | `cd web && npx vitest run` |
| Web e2e (Playwright) | **221** pass, 15 opt-in skipped | `web/e2e` |
| Claims in `docs/claims.json` | **446**: offline 178 PASS, 0 FAIL, 0 ERROR, 268 SKIP | `node verify/verify-claims.mjs --offline`; the historical online result does not validate this candidate |

The batch-2 counts (contract 457, sandbox 63, worker 830; contract-side 520;
Rust total 1,350) replace the rows above at PR time, once the merged main's CI
is 6/6 and the counts are re-read from that run — not from this draft.

## Pledge reproduction — source candidates and generated live identities

Reproduce without wallets, deployments or spending. Use Node **22.22.2** (`web/.nvmrc`) and npm **10.8.2**, the same pinned pair as the web CI job:

```bash
export CARGO_BUILD_JOBS=1 NODE_OPTIONS=--max-old-space-size=3072
(cd contracts/keys && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings -A clippy::manual_range_contains && ./build.sh)
# Fault injection is sandbox-only, never a release/deploy artifact:
(cd contracts/keys && ./build.sh --features callback-failure-fixture && cp target/near/keyhole_keys.wasm ../keys-sandbox/tests/fixtures/callback_failure.wasm && ./build.sh && cmp target/near/keyhole_keys.wasm release/v2.7/keyhole_keys.wasm && ./build-sandbox-delay.sh)
(cd contracts/keys-sandbox && ./build-policy-mock.sh && cargo test --locked -- --test-threads=1)
(cd tee/worker && cargo test --locked && cargo clippy --locked --all-targets -- -D warnings && cargo clippy --locked --target wasm32-wasip2 -- -D warnings && ./build.sh && node verify-log.mjs --self-test)
(cd web && npm ci && npm run lint && npm run typecheck && npm test && npm run build)
(cd cli && npm ci && npm test && npx tsc -p . --noEmit)
node --test scripts/pledge/*.test.mjs scripts/check-worker-candidate.test.mjs
node scripts/check-worker-candidate.mjs
node scripts/gen-identity.mjs --worker-candidate --contract-candidate --check
python3 verify/gen-claims.py .
node verify/verify-claims.mjs --offline
```

The runtime suite uses real local NEAR receipts with labelled custody/transport mocks. [Current repair proof and finding map](evidence/worker-provisioning/R4.md) · [Live identities](#live-identities). Safety and release status: [SECURITY.md](../SECURITY.md#two-sided-pledge-ui-release-gate).
