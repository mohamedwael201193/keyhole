# Track coverage

Track mapping: implemented features and their concrete evidence. This is not certification that every optional prompt or trust property is complete; residual boundaries are retained in [SECURITY.md](SECURITY.md#qualifications-moved-from-the-readme).
Current release: contract v2.7 and guarded worker `62398a8a` are live; lending remains OFF. Each scope label describes only the feature actually evidenced.

Official NFT-track sentence, quoted once from the [HACKATHON.md tracks table](https://nearhackathon.com/HACKATHON.md): “Build NFTs as accounts — assets that own money, earn royalties, hold inventory, carry credentials, memberships or access rights. Ownership with behavior.” The prompt file is a separate reference and is worded differently: [tracks/10-nfts.md](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/10-nfts.md).

| Capability | Implementation | Do this / see this | Proof | Status |
|---|---|---|---|---|
| NFT as the account | `keyhole-devmo.near` plus one TEE custody wallet per token | Open [/key](https://www.getkeyhole.xyz/key) | [THREAT_MODEL.md](THREAT_MODEL.md) | Current. Not a NEAR subaccount |
| Royalties | `nft_buy` pays `royalty_bps` 500 | Read the recorded sale | [docs/evidence/contract-v2](docs/evidence/contract-v2/README.md) | Current |
| Sealed inventory | Holder vault inside the enclave | Open [/vault](https://www.getkeyhole.xyz/vault) as the holder | [SECURITY.md](SECURITY.md#viewing-right-and-selective-disclosure) | Current for the holder. Not a zero-knowledge balance |
| Access right | `/holders` checks the connected account's tokens | Open [/holders](https://www.getkeyhole.xyz/holders) | [web/app/holders](web/app/holders) | Authenticated holder proof. Not authorization for every confidential byte |
| Borrow caps | `tier_loan_cap`: 0.05 / 0.5 / 5 NEAR | Read the mint page | [`contracts/keys/src/pledge.rs`](contracts/keys/src/pledge.rs) | Configured maxima. Lending is off. Nonce 0. Not a completed loan |
| Chain address | Browser derivation from the minter and token id | Open `/key` | [signature evidence, historical](docs/evidence/publish-09d481a5/README.md#chain-signatures-one-real-mpc-signature) | Derivation only. Signing is disabled |

## NFTs That Do Something (primary)

| Requirement | KEYHOLE feature | Evidence | Implemented scope |
|---|---|---|---|
| NEP-171 contract tying each token to an account it controls | `keyhole-devmo.near` keys contract (NEP-171/177/178/181/199/330, one key per account enforced on-chain; [royalty sale on mainnet](docs/evidence/contract-v2/README.md); v2.3 historical, [evidence](docs/evidence/contract-v2-3/README.md)); each key maps to a confidential account inside the TEE that only the current owner can drive | [`contracts/keys`](contracts/keys), README §5, live [/gallery](https://www.getkeyhole.xyz/gallery) | ✅ |
| README: how control passes on transfer, what stops the old owner | The worker reads `nft_token` owner on every request; old owner gets `not_owner`; holder limits and locks bind only the holder who set them; 10-minute withdraw cooldown after a transfer | README §5 and §9, [THREAT_MODEL.md](THREAT_MODEL.md); historical build a985fd87: sale run with team test wallets, [docs/evidence/transfer-a985fd87](docs/evidence/transfer-a985fd87/README.md) (calls `2a52742a`, `3e996273`, `15f93f58`, `8485f8d4`); earlier builds: calls `e72dc176`, `711795b9`, `369f522d` | ✅ |
| Gated page only current holders can open | /vault: balances, history and actions need a fresh NEP-413/EIP-191 signature from the current owner | live [/vault](https://www.getkeyhole.xyz/vault), e2e | ✅ |
| History per NFT: earned, paid out, who held it | /key?id=…: holders with from/to, deposits, payouts, trades; hash-chained log signed by the TEE minter, re-verified in the browser; USD totals as signed PnL | [/key?id=k5f4750858f328940](https://www.getkeyhole.xyz/key?id=k5f4750858f328940), [/pnl](https://www.getkeyhole.xyz/pnl), [`web/tests/keylog.test.ts`](web/tests/keylog.test.ts) | ✅ (USD per holder is private by design; holders publish it as signed PnL) |
| Tests for the transfer path incl. a sale in the middle of a payout | 6 worker invariant tests; mainnet run where the key moved while a payout was in flight | `tee/worker/src/tests.rs`, [docs/evidence/mid-payout](docs/evidence/mid-payout/README.md) | ✅ |
| Threat model for the transfer | Every way a seller could keep the money, with the control that stops it | [THREAT_MODEL.md](THREAT_MODEL.md) | ✅ |
| Sub-accounts / Top Level Accounts | Confidential per-key accounts live in the TEE (OutLayer), not NEAR sub-accounts | README §5 | Per-token TEE wallets; architecture boundary in SECURITY |

## Privacy & Private AI

| Requirement | KEYHOLE feature | Evidence | Implemented scope |
|---|---|---|---|
| NEAR AI Cloud via OpenAI-compatible API, TEE model from the models endpoint | /api/ai picks a TEE-attested model (`Qwen/Qwen3.6-35B-A3B-FP8`), key only in a server env var | `web/app/api/ai/route.ts`, live [/ask](https://www.getkeyhole.xyz/ask) | ✅ |
| Attestation with a fresh nonce, verified per the docs; "Verified" panel listing each check | Browser makes a 32-byte nonce; panel shows 7 checks (nonce and signer in the TDX quote, nonce echo, request and response hashes, model, ECDSA signature) | `web/lib/ai.ts`, `tests/ai.test.ts` | Intel DCAP + request/response bindings; NVIDIA scope in SECURITY |
| Keep nothing server-side | No storage, no logging, `no-store` headers; stated in README and code | `web/app/api/ai/route.ts` | ✅ |
| Fictional sample documents | Sample statement, sample vault, and a poisoned note | /ask sample chips | ✅ |
| Confidential computation | Every account op runs in an Intel TDX enclave; /verify runs 37 checks in the browser: 6 attestation checks, 19 Intel DCAP checks on the quote, and 12 Intel PCS checks (revocation lists, TCB Info, QE identity; TCB status UpToDate) | [/verify](https://www.getkeyhole.xyz/verify), `web/lib/dcap.ts` | ✅ (Intel PCS collateral is fetched through `/api/pcs`, a fixed-URL pass-through, and every signature is checked in the browser) |

## Unstoppable DeFi

| Requirement | KEYHOLE feature | Evidence | Implemented scope |
|---|---|---|---|
| 1Click API for quotes, deposits, status | Worker quotes through 1Click (`confidentiality: basic \| advanced`, dry first, wet only on execute); vault swaps execute through OutLayer's confidential-swap API; /settle runs standalone 1Click orders | README §8, swap call `7f52f7d8` | ✅ |
| Handle REFUNDED and FAILED, shown in the UI | /settle shows every 1Click status with where the funds are; a real NO_LIQUIDITY refund reads REFUNDED live; FAILED shows the refund address | [/settle](https://www.getkeyhole.xyz/settle), [`docs/evidence/oneclick-sol`](docs/evidence/oneclick-sol/README.md), [PR #62](https://github.com/mohamedwael201193/keyhole/pull/62), e2e `settle: the real SOL→NEAR order reads SUCCESS live…` | ✅ |
| Show where funds sit at every step | Vault shows sealed balances and deposit addresses | /vault | Balance/deposit/status views |
| History of executed buys with explorer links | Vault history lists trades; intent explorer links | /vault | Recorded execution/intent links |
| Dry-run mode with real quotes, no funds | /settle **Dry-run quote** asks 1Click for a real quote with `dry: true` (no deposit address, no funds); CLI `quote` without `--execute` | [/settle](https://www.getkeyhole.xyz/settle), [`web/app/api/oneclick/route.ts`](web/app/api/oneclick/route.ts) (refuses any non-dry body), [`web/tests/oneclick.test.ts`](web/tests/oneclick.test.ts), e2e `settle: dry-run quote…` in [`web/e2e/site.spec.ts`](web/e2e/site.spec.ts) | ✅ |
| Chain Signatures stretch | Per-key EVM address from `v1.signer`: the enclave's `chain_address` (cross-checked on chain), and the same address derived in the browser on `/key` (no signing). Signing is not live: the guarded revision refuses `chain_sign` with `unsupported_authority`. One MPC signature was made earlier on the superseded `09d481a5` (tx 7P9VFx4p…) | [signature evidence (historical)](docs/evidence/publish-09d481a5/README.md#chain-signatures-one-real-mpc-signature), [call 3d81f582](https://api.outlayer.ai/attestations/by-call/3d81f582-0548-46ed-8491-eb95a9ffa924) | Derivation only; signing disabled in this build |

## AI Security & Defense

| Requirement | KEYHOLE feature | Evidence | Implemented scope |
|---|---|---|---|
| Spending limits / policy engine for agents | Tier caps, holder caps (cut now, raise after 24 h), per-minute limits, lock, cooldown, enforced inside the TEE | worker tests, calls `afaaf3e1`, `06cf2630` | ✅ |
| Agent signs with a scoped key, limits explained | Function-call key on the TEE minter: `beat` on `keyhole-devmo.near` only, 0.05 NEAR gas allowance, no deposit or transfer possible; added by the enclave on the owner's signed request. Real beat with it on mainnet; other method, deposit and transfer refused by NEAR. Holder requests stay NEP-413 signed by a full-access key of the NFT owner | README "Key scoping" and "AI Security & Defense" (what the key cannot do; why payments still need a full-access key: the worker refuses function-call keys for holder requests), [evidence](docs/evidence/publish-09d481a5/README.md#scoped-beat-key) | Scoped heartbeat key |
| Agent wallet with a policy (NEAR Intents Agent API) | The holder's Bronze caps are written as an Agent API policy (swap only; $1 per swap and $5 per day on each USDC; only the six assets KEYHOLE routes), applied through the Agent API demo partner deployment on the mainnet network; /settle reads the live policy and checks it equals the caps, and dry quotes over the cap come back with the API's own policy warning | [tx biJNTxXc…](https://nearblocks.io/txns/biJNTxXc9zbQw6nTMJoPM2HeAE9snEf1mSdbsZ1CWEQ), [`docs/evidence/agent-api`](docs/evidence/agent-api/demo_2026-11-03.json), [/settle](https://www.getkeyhole.xyz/settle), [`web/tests/agentPolicy.test.ts`](web/tests/agentPolicy.test.ts) | ✅ |
| Attack demo: prompt-injected agent tries to pay a bad address, with a log | Six mainnet attack calls, all stopped; /ask shows the model ignoring a poisoned note | [docs/evidence/prompt-injection](docs/evidence/prompt-injection/README.md) | ✅ |
| Counterparty check service (allow / warn / block) with signals, a shared blocklist and an agent wrapper | `cli/src/counterparty.ts` (identical copy in `web/lib/counterparty.ts`), served by `GET /api/check`; `guardedRun` on withdraw, quote --execute and MCP copy; blocklist in `security/blocklist.json` (one labelled demo entry, no real accusations); signed report format in `cli/src/report.ts`. Advisory only: not enforced in the TEE; [scope](SECURITY.md#counterparty-check-boundary) | README "AI Security & Defense: counterparty check", [`cli/test/counterparty.test.ts`](cli/test/counterparty.test.ts), [`cli/test/guard.test.ts`](cli/test/guard.test.ts), [`web/tests/check.test.ts`](web/tests/check.test.ts) | Advisory CLI/MCP and read-only web check |
| Attack demo on the guard: a scripted agent obeys an injected instruction, the guard refuses before signing | [`scripts/attack-demo.mts`](scripts/attack-demo.mts): the signer is a stub that throws, and the run asserts it was never called. Refusals only: the worker does not yet pay third parties | [log](docs/evidence/attack-demo/2026-11-07.log) | Local refusal-before-signing demo |
| TEE attestation | /verify, `verify.sh`, judge kit | README §7 | ✅ |

## Counts

Historical snapshot at `d0305f2`: 1551 passing tests (contract 119 + 6 sandbox, worker 432, CLI 7, web unit 916, e2e 71 distinct). That snapshot is not the current artifact. Evidence: [CI run 41731806624](https://github.com/mohamedwael201193/keyhole/actions/runs/41731806624), [`docs/evidence/tests`](docs/evidence/tests/README.md).

Current recorded suites are in [`docs/metrics.json`](docs/metrics.json): the CLI and web unit rows only. Contract, worker, sandbox and Playwright are excluded from that total. CI run [43043510571](https://github.com/mohamedwael201193/keyhole/actions/runs/43043510571) logged contract 342, worker 656, and sandbox 62 pass with 1 ignored. Those are CI log counts, not a local cargo rerun, and they are not rows in `docs/metrics.json`.

## Continuity

The site (Vercel) and the OutLayer worker are paid from the project account `keyhole-devmo.near` and stay up through judging. The NFT contract is on mainnet and every proof (attestations, FastFS wasm, transactions) is public, so verification never depends on our servers.
