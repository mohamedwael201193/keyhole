<p align="center"><img src="docs/images/emblem.webp" width="110" alt="KEYHOLE"></p>

# KEYHOLE

## Private accounts. Transferable.

KEYHOLE is an NFT that transfers control of a confidential trading account. Trade through **NEAR Intents**, transfer or sell the key, and the next holder operates the same account. The previous holder's next protected operation is refused. [Handover evidence](docs/evidence/transfer-a985fd87/README.md) · [Sale evidence](docs/evidence/earned-tier-and-sale/README.md)

[**Open the app**](https://keyhole-seven.vercel.app) · [**Verify on mainnet**](https://keyhole-seven.vercel.app/verify) · [**Judge walkthrough**](https://keyhole-seven.vercel.app/judge) · [**Recorded attacks**](https://keyhole-seven.vercel.app/attack) · [CI](https://github.com/mohamedwael201193/keyhole/actions/workflows/ci.yml)

| Live component | Identity | Open the proof |
|---|---|---|
| NEAR mainnet NFT contract | [`keyhole-devmo.near`](https://nearblocks.io/address/keyhole-devmo.near), v2.4; code hash from [identity.json](identity.json) | [Deployment transaction and receipts](https://nearblocks.io/txns/84zVBikU5JrAAnyaXTHQWwQSuq15zgLmMFJZsVnJZsPn) |
| OutLayer Intel TDX worker | wasm sha256 from [identity.json](identity.json) | [Publish transaction BWQxEoSg](https://nearblocks.io/txns/BWQxEoSg3b6XHdk4iooAneoBJM7EtP83HTrvYXpdBQi5) · [Recorded info attestation](https://api.outlayer.ai/attestations/by-call/dc3668db-674f-4865-a2ce-272f70c41b0d) |
| Web application | [`keyhole-seven.vercel.app`](https://keyhole-seven.vercel.app) | [/verify](https://keyhole-seven.vercel.app/verify) reads public evidence; [/key](https://keyhole-seven.vercel.app/key?id=k5f4750858f328940) verifies signed account history |

[identity.json](identity.json) is the single release-hash source (`node scripts/gen-identity.mjs --check`). [SECURITY.md](SECURITY.md) defines the privacy, custody, authority and verification boundaries.

## Reproduce it yourself

### Five-minute public path

**Prerequisites:** a checkout or downloaded ZIP of this public repository, **Node.js 20+**, Bash, and internet access. Open a terminal in the repository root. **No npm install, wallet, project credentials, transaction or transfer is needed.**

<!-- judge:quick -->
```bash
node scripts/gen-identity.mjs --check
node judge/readme-verify.mjs
node judge/verify-claims.mjs
```

The commands themselves are exercised from this README by [the CI command runner](judge/check-readme.mjs). [Recorded command output](docs/evidence/readme-verification/README.md) includes the shell environment, elapsed time and exact verdicts.

| Check | What you reproduce |
|---|---|
| Contract/build identity | Hash the committed contract Wasm, compare the mainnet `code_hash` and release manifest; hash the published worker bytes from FastFS and compare them with the info attestation and manifest. |
| Public contract state | Call `config`, `contract_source_metadata`, `nft_total_supply` and `nft_token` over public NEAR RPC; print the current version, supply, holder, minter and contract key permissions. |
| Recorded attack refusals | Download the original attestations; hash each stored refusal output with canonical JSON and match `output_hash`. Print its original call ID, error and build. |
| Fresh gateway negatives | Submit an unauthenticated disallowed `copy` operation and an oversized body: expect `400 bad_op` and `413`. These are gateway checks, not new enclave attacks. |
| Signed swap log | Fetch public `provenance`; recompute every event hash and the head, check its Ed25519 signature against the minter read from the contract, and bind the output to the recorded worker hash. Editing an event must fail. |
| Claim ledger | Re-run [docs/claims.json](docs/claims.json) against source files, public RPC, transaction receipts, attestations, FastFS and the site. Every row names its evidence and individual verification command. |

For the **browser cryptographic path**, open [/verify](https://keyhole-seven.vercel.app/verify?call=dc3668db-674f-4865-a2ce-272f70c41b0d): its [verifier](web/components/judge/CallVerifier.tsx) runs 6 attestation, 19 Intel DCAP and 12 Intel collateral checks. Quote validity, exact output binding, financial meaning and current-build identity are displayed separately. The terminal quick path checks hashes, signatures and quote presence; use the browser for the Intel certificate/TCB verification.

### Reproduce without network

<!-- judge:offline -->
```bash
node scripts/gen-identity.mjs --check
node --test judge/readme-verify.test.mjs
node judge/readme-verify.mjs --offline
node judge/verify-claims.mjs --offline
```

Offline checks verify the committed artifacts, recorded signed swap log and negative mutations. Network checks print **SKIP**. The claim ledger distinguishes **FAIL** (contradiction), **ERROR** (unreachable evidence) and **SKIP** (not checked); none means “passed.” See [judge/README.md](judge/README.md).

## Why this NFT exists

The transferable asset is **control of a particular funded account**, not an exported private key and not just artwork. The account's identity persists while its authorized holder changes. [Token-to-wallet mapping](tee/worker/src/main.rs) · [NEP-171 contract](contracts/keys/src/lib.rs)

| What the holder can do | What makes it useful | Evidence |
|---|---|---|
| Fund and trade | Hold supported assets in the account and exchange them through NEAR Intents/1Click | [Attested USDC → wNEAR swap](docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json) · [Site swap](https://api.outlayer.ai/attestations/by-call/9f76716e-b3d6-4081-b50f-fdff21a60f82) (**previous build** `cc8d2fa8`) |
| Transfer control | The buyer receives the same token-bound account; the old holder's new signed requests are refused | [Transfer, old-owner refusal, new-owner read](docs/evidence/transfer-a985fd87/README.md) (**previous build** `a985fd87`) |
| List and sell | Listing freezes swap/withdraw; purchase transfers title and retains the earned tier | [List → frozen → buy → old owner refused](docs/evidence/earned-tier-and-sale/README.md) (**previous build** `cc8d2fa8`) |
| Verify a listed key | Read a minter-signed statement of tier, settled swaps, volume and log head | [Signed record, build `d337e822`](docs/evidence/signed-record/README.md) · [Browser verifier](web/lib/keyRecord.ts) |
| Inspect history | Verify holder transitions, event commitments and the signed chain head | [Public key history](https://keyhole-seven.vercel.app/key?id=k5f4750858f328940) · [Signed snapshot](docs/evidence/readme-verification/public-log.json) |
| Set a bounded session | Sign once for scoped, capped access; withdraw still asks for a fresh wallet signature | [Session implementation and tests](tee/worker/src/session.rs) · [Session checks](tee/worker/src/session.rs) |

**Account value is grounded in its supported assets and rights.** Settled swaps and earned tiers describe behavior; the signed swap log records activity, rather than inventing a performance valuation. See [the record schema](tee/worker/src/lib.rs) and [tier rules](tee/worker/src/level.rs). Financial interpretation lives in SECURITY.md. A signed log result establishes integrity of the returned event chain.

## How control passes

1. **The NFT contract is the title registry.** NEP-171 ownership lives on `keyhole-devmo.near`; [`holder_wallet`](tee/worker/src/main.rs) maps `token_id` to its confidential custody wallet.
2. **The worker authenticates the action.** A wallet signs the operation and its parameters with NEP-413 or EIP-191; the worker checks signature, freshness, nonce, current NFT owner and policy. [Authentication](tee/worker/src/lib.rs) · [Session checks](tee/worker/src/session.rs)
3. **The worker re-reads ownership before dispatch.** Swap/withdraw re-read the owner; new ownership applies to the same token-bound wallet. [Transfer threat model](docs/TRANSFER_THREAT_MODEL.md) · [Settlement rules](THREAT_MODEL.md)
4. **The next holder proves control with their own wallet.** The seller's next request fails `not_owner`; a buyer's first withdrawal observes the new-owner cooldown. [Positive and negative handover evidence](docs/evidence/transfer-a985fd87/README.md)
5. **Anyone can verify a public log head.** Events commit to private details, the minter signs the head, and [/key](https://keyhole-seven.vercel.app/key?id=k5f4750858f328940) checks the chain and signer. [Log verifier](tee/worker/verify-log.mjs) · [Executable negative tests](judge/readme-verify.test.mjs)

```text
Holder wallet ── signed intent ──► Gateway ──► OutLayer TDX worker
                                              │       │
                                   NEAR NFT owner     token-bound custody
                                              │       │
                                              └── NEAR Intents / 1Click
                                                      │
                                      attested reply + settlement evidence
                                                      ▼
                                          /verify · /key · /settle
```

### One account, distinct evidence types

| Evidence | Read it as |
|---|---|
| [Current manifest](identity.json), public RPC, live FastFS bytes | Current deployed identities and state at the time you read them |
| [Recorded handover](docs/evidence/transfer-a985fd87/README.md), [sale](docs/evidence/earned-tier-and-sale/README.md), [mid-payout run](docs/evidence/mid-payout/README.md) | Historical mainnet executions with named builds and team test wallets |
| [/attack](https://keyhole-seven.vercel.app/attack) | Re-fetch and re-check recorded refusals/transfer; not newly signed attack transactions |
| [Fresh quick-path gateway probes](judge/readme-verify.mjs) | New HTTP-level negatives, separate from the historical worker refusals |
| [/demo](https://keyhole-seven.vercel.app/demo) | Labelled read-only replay |
| [Sandbox transfer tests](contracts/keys-sandbox/tests/upgrade.rs), [local attack demo](docs/evidence/attack-demo/2026-11-07.log) | Local execution; not mainnet transactions |

The [full proof reference](PROOFS.md) retains original call IDs, transaction links, build history and the 30-step recorded run. The [explicit evidence index](judge/evidence-index.json) retains historical build constraints and regression-test pointers independently of README length. Concurrency, payout timing, privacy and administrative authority are interpreted in SECURITY.md.

## NEAR is load-bearing

| Component | Responsibility | Implementation / proof |
|---|---|---|
| NEP-171 / NEP-177 / NEP-178 / NEP-181 | Transferable control title, metadata, approvals and enumeration | [Keys contract](contracts/keys/src/lib.rs) · [Deployment](docs/evidence/contract-v2-4/README.md) |
| NEP-199 and built-in sale | Payout split and purchase/transfer behavior | [Sandbox sale tests](contracts/keys-sandbox/tests/upgrade.rs) · [Recorded sale](docs/evidence/earned-tier-and-sale/README.md) |
| NEP-413 and EIP-191 | Holder-signed intents, independent of a page's login state | [Worker verification](tee/worker/src/lib.rs) · [Browser signing](web/lib/nep413.ts) |
| NEAR Intents / 1Click | Asset conversion and cross-chain settlement with terminal order status | [SUCCESS and REFUNDED receipts](docs/evidence/oneclick-sol/README.md) · [Activity](https://keyhole-seven.vercel.app/settle) |
| OutLayer Intel TDX | Confidential worker execution, sealed application storage and per-call evidence | [Worker](tee/worker) · [Attestation verifier](https://keyhole-seven.vercel.app/verify) |

This implements the NFT track's **“NFTs as accounts … Ownership with behavior”**: token/resource binding, holder-gated actions, history, transfer tests and a written transfer threat model. [Official track prompt](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/10-nfts.md) · [Official tracks/resources](https://nearhackathon.com/#tracks) · [NEAR contract-audit guidance](https://github.com/near/agent-skills/tree/main/skills/near-contract-audit)

## Use the account

Start at [/vault](https://keyhole-seven.vercel.app/vault): connect a supported wallet, mint a Bronze key, then **Fund → Swap → Withdraw**. The wallet signs explicit operations; value-moving actions show their amounts and settlement state. [Vault implementation](web/app/vault) · [CLI instructions](cli/README.md) · [Agent skill](skills/keyhole/SKILL.md)

For a buyer, open [/key?id=k5f4750858f328940](https://keyhole-seven.vercel.app/key?id=k5f4750858f328940): inspect ownership and signed history; when listed, the Sale card verifies the seller record before offering the purchase. [Sale card](web/app/key/sale.tsx)

<details>
<summary>Page and source index</summary>

| Page | Purpose | Source |
|---|---|---|
| `/` | Product and public chain facts | [Home](web/app/page.tsx) |
| `/vault` | Holder account and actions | [Vault](web/app/vault) |
| `/mint` | Mint a control key | [Mint](web/app/mint) |
| `/gallery` | Public keys | [Gallery](web/app/gallery) |
| `/key` | Signed history and sale | [Key](web/app/key) |
| `/verify` | Per-call and deployment evidence | [Verifier](web/app/verify) |
| `/attack` | Re-check recorded refusals | [Attack board](web/components/judge/AttackBoard.tsx) |
| `/judge` | No-wallet guided checks | [Judge](web/app/judge) |
| `/settle` | Quotes and order statuses | [Settlement](web/app/settle) |
| `/pnl` | Holder-published signed swap log | [Swap log](web/app/pnl) |
| `/ask` | NEAR AI Cloud assistant with verification | [Private AI](web/app/ask) |
| `/atlas` | On-chain evidence trails | [Atlas](web/app/atlas) |
| `/identity` | Deterministic key artwork | [Identity](web/app/identity) |

</details>

## Builds, tests and continuous proof

The [release manifest](identity.json), [contract release hashes](contracts/keys/release/SHA256SUMS), [pinned source archive](web/public/source/manifest.json) and [CI workflow](.github/workflows/ci.yml) expose the source/build/runtime chain. The command transcript records which source was actually rebuilt and the resulting hash. [Rebuild transcript](docs/evidence/readme-verification/README.md)

CI retains **6 jobs (contract, worker, cli, judge-kit, hygiene, web)**. Contract/sandbox tests, worker tests, CLI tests and web unit/e2e tests run in their respective jobs. The judge-kit executes the README's offline and online command blocks, checks identity drift and regeneration, and runs negative proof mutations. [Workflow](.github/workflows/ci.yml) · [README acceptance runner](judge/check-readme.mjs)

To regenerate the machine-readable evidence ledger after a documentation change (Python 3 required):

<!-- judge:generate -->
```bash
python3 judge/gen-claims.py .
node judge/verify-claims.mjs --offline
```

[THREAT_MODEL.md](THREAT_MODEL.md) · [Transfer model](docs/TRANSFER_THREAT_MODEL.md) · [Contract review](docs/audit/keys-contract.md) · [Agent judge instructions](JUDGE_AGENT.md)

## Authorship and license

Built by **devmo**, with AI coding assistance. [First code commit](https://github.com/mohamedwael201193/keyhole/commit/66f7070) · [Dependency and contribution disclosure](CONTRIBUTIONS.md) · [MIT license](LICENSE)
