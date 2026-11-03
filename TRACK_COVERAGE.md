# Track coverage

Each official track prompt, line by line: what KEYHOLE ships for it, where the proof is, and an honest status.
✅ shipped and live on mainnet · 🟡 partial or a different shape · ❌ not done. Last checked 2026-11-01.

## NFTs That Do Something (primary)

| Requirement | KEYHOLE feature | Evidence | Status |
|---|---|---|---|
| NEP-171 contract tying each token to an account it controls | `keyhole-devmo.near` keys contract (NEP-171/177/199); each key maps to a confidential account inside the TEE that only the current owner can drive | [`contracts/keys`](contracts/keys), README §5, live [/gallery](https://keyhole-seven.vercel.app/gallery) | ✅ |
| README: how control passes on transfer, what stops the old owner | The worker reads `nft_token` owner on every request; old owner gets `not_owner`; holder limits and locks bind only the holder who set them; 10-minute withdraw cooldown after a transfer | README §5–§8, [THREAT_MODEL.md](THREAT_MODEL.md), calls `e72dc176`, `711795b9`, `369f522d` | ✅ |
| Gated page only current holders can open | /vault: balances, history and actions need a fresh NEP-413/EIP-191 signature from the current owner | live [/vault](https://keyhole-seven.vercel.app/vault), e2e | ✅ |
| History per NFT: earned, paid out, who held it | /key?id=…: holders with from/to, deposits, payouts, trades; hash-chained log signed by the TEE minter, re-verified in the browser; USD totals as signed PnL | [/key?id=k5f4750858f328940](https://keyhole-seven.vercel.app/key?id=k5f4750858f328940), [/pnl](https://keyhole-seven.vercel.app/pnl), `tests/keylog.test.ts` | ✅ (USD per holder is private by design; holders publish it as signed PnL) |
| Tests for the transfer path incl. a sale in the middle of a payout | 6 worker invariant tests; mainnet run where the key moved while a payout was in flight | `tee/worker/src/tests.rs`, [docs/evidence/mid-payout](docs/evidence/mid-payout/README.md) | ✅ |
| Threat model for the transfer | Every way a seller could keep the money, with the control that stops it | [THREAT_MODEL.md](THREAT_MODEL.md) | ✅ |
| Sub-accounts / Top Level Accounts | Confidential per-key accounts live in the TEE (OutLayer), not NEAR sub-accounts | README §1 | 🟡 different shape |

## Privacy & Private AI

| Requirement | KEYHOLE feature | Evidence | Status |
|---|---|---|---|
| NEAR AI Cloud via OpenAI-compatible API, TEE model from the models endpoint | /api/ai picks a TEE-attested model (`Qwen/Qwen3.6-35B-A3B-FP8`), key only in a server env var | `web/app/api/ai/route.ts`, live [/ask](https://keyhole-seven.vercel.app/ask) | ✅ |
| Attestation with a fresh nonce, verified per the docs; "Verified" panel listing each check | Browser makes a 32-byte nonce; panel shows 7 checks (nonce and signer in the TDX quote, nonce echo, request and response hashes, model, ECDSA signature) | `web/lib/ai.ts`, `tests/ai.test.ts` | ✅ (the Intel/NVIDIA cert chain of the AI quote is not re-checked in the browser; said on the page) |
| Keep nothing server-side | No storage, no logging, `no-store` headers; stated in README and code | `web/app/api/ai/route.ts` | ✅ |
| Fictional sample documents | Sample statement, sample vault, and a poisoned note | /ask sample chips | ✅ |
| Confidential computation | Every account op runs in an Intel TDX enclave; /verify runs 37 checks in the browser: 6 attestation checks, 19 Intel DCAP checks on the quote, and 12 Intel PCS checks (revocation lists, TCB Info, QE identity; TCB status UpToDate) | [/verify](https://keyhole-seven.vercel.app/verify), `web/lib/dcap.ts` | ✅ (CRL and TCB status need Intel PCS; not checked, said on the page) |

## Unstoppable DeFi

| Requirement | KEYHOLE feature | Evidence | Status |
|---|---|---|---|
| 1Click API for quotes, deposits, status | Worker quotes, deposits and swaps through 1Click (confidential mode) | README §11, swap call `7f52f7d8` | ✅ |
| Handle REFUNDED and FAILED, shown in the UI | /settle shows every 1Click status with where the funds are; a real NO_LIQUIDITY refund reads REFUNDED live; FAILED shows the refund address | [/settle](https://keyhole-seven.vercel.app/settle), [`docs/evidence/oneclick-sol`](docs/evidence/oneclick-sol/README.md), [PR #62](https://github.com/mohamedwael201193/keyhole/pull/62), e2e `settle: the real SOL→NEAR order reads SUCCESS live…` | ✅ |
| Show where funds sit at every step | Vault shows sealed balances and deposit addresses | /vault | 🟡 |
| History of executed buys with explorer links | Vault history lists trades; intent explorer links | /vault | 🟡 links being added |
| Dry-run mode with real quotes, no funds | /settle **Dry-run quote** asks 1Click for a real quote with `dry: true` (no deposit address, no funds); CLI `quote` without `--execute` | [/settle](https://keyhole-seven.vercel.app/settle), [`web/app/api/oneclick/route.ts`](web/app/api/oneclick/route.ts) (refuses any non-dry body), [`web/tests/oneclick.test.ts`](web/tests/oneclick.test.ts), e2e `settle: dry-run quote…` in [`web/e2e/site.spec.ts`](web/e2e/site.spec.ts) | ✅ |
| Chain Signatures stretch | Per-key EVM address from `v1.signer` (`chain_address`, cross-checked on chain) and a real MPC signature for that address (`chain_sign`, tx 7P9VFx4p…), live in enclave `09d481a5` | [signature evidence](docs/evidence/publish-09d481a5/README.md#chain-signatures-one-real-mpc-signature), [call 3d81f582](https://api.outlayer.ai/attestations/by-call/3d81f582-0548-46ed-8491-eb95a9ffa924) | ✅ |

## AI Security & Defense

| Requirement | KEYHOLE feature | Evidence | Status |
|---|---|---|---|
| Spending limits / policy engine for agents | Tier caps, holder caps (cut now, raise after 24 h), per-minute limits, lock, cooldown, enforced inside the TEE | worker tests, calls `afaaf3e1`, `06cf2630` | ✅ |
| Agent signs with a scoped key, limits explained | Function-call key on the TEE minter: `beat` on `keyhole-devmo.near` only, 0.05 NEAR gas allowance, no deposit or transfer possible; added by the enclave on the owner's signed request. Real beat with it on mainnet; other method, deposit and transfer refused by NEAR. Holder requests stay NEP-413 signed by a full-access key of the NFT owner | README "Key scoping", [evidence](docs/evidence/publish-09d481a5/README.md#scoped-beat-key) | ✅ |
| Attack demo: prompt-injected agent tries to pay a bad address, with a log | Six mainnet attack calls, all stopped; /ask shows the model ignoring a poisoned note | [docs/evidence/prompt-injection](docs/evidence/prompt-injection/README.md) | ✅ |
| Counterparty check service (allow / warn / block) | — | — | ❌ not our product |
| TEE attestation | /verify, `verify.sh`, judge kit | README §9 | ✅ |

## Counts (reproduce in README §12)

488 passing tests: contract 43, worker 195, CLI 7, web unit 194, e2e 49 (run at 1440 and 390 px). Evidence: [CI run 41516049447](https://github.com/mohamedwael201193/keyhole/actions/runs/41516049447), [`docs/evidence/tests`](docs/evidence/tests/README.md). 8 of 10 common integrations live on mainnet: OutLayer, NEAR AI Cloud, 1Click, wallets (NEAR + MetaMask), NEP-171, NEP-177, NEP-199, NEP-413.
