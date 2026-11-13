# Proof index

Six public records are six records. They are not six customers and they are not commercial traction. No completed loan is claimed. Lending is off. The next loan nonce is 0. The owner is the guardian implicit account `0705fdc1…`.

Attribution is only what the record itself says. **Team** means this repository already names that wallet as the operator's. **Unknown** means control is not established. A different address is not verified external usage. This index has no verified-external row. Six public records are not six customers and they are not commercial traction.

## Record attribution

| Record | Status | Attribution | Why this label |
|---|---|---|---|
| [Vault swap `09d58c09`](docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json) | Historical build `f13efe92` | Team | [`web/lib/settlements.ts`](web/lib/settlements.ts) names account `keyhole-devmo.near`, the operator account |
| [1Click 0.03 wNEAR](web/lib/settlements.ts) | Recorded order | Team | The same file says the 1 Nov 2026 orders are from `keyhole-devmo.near` |
| [1Click under-deposit](web/lib/settlements.ts) | Recorded order | Team | Same operator note as the row above |
| [1Click 0.6 USDC on Base](web/lib/settlements.ts) | Recorded order | Unknown | A MetaMask address is named. That does not establish an independent user |
| [1Click 0.004 SOL](web/lib/settlements.ts) | Recorded order | Unknown | Arrival at the operator account does not prove who controlled the sender |
| [1Click 0.001 SOL refund](web/lib/settlements.ts) | Recorded order | Unknown | Same limit as the row above |
| Verified external usage | — | None in this index | A different wallet is not this row |

## Attempted action, refusal, proof

These are recorded refusals. They are not a completed loan. Lending is off. The next loan nonce is 0.

| Attempted action | Refusal | Attestation | Output check | Build |
|---|---|---|---|---|
| Tampered message | `bad_signature` | [`942b4cff`](https://api.outlayer.ai/attestations/by-call/942b4cff-23c9-4e4d-8ebc-79bfa01cd029) | [`19_tampered_refused.json`](docs/evidence/mainnet-e2e/19_tampered_refused.json) | Historical `f13efe92` |
| Same signed request again | `replay` | [`ac289f04`](https://api.outlayer.ai/attestations/by-call/ac289f04-0df8-4161-9123-e872ab3b75ab) | [`17_replay_second_refused.json`](docs/evidence/mainnet-e2e/17_replay_second_refused.json) | Historical `f13efe92` |
| No signature | `no_auth` | [`750defed`](https://api.outlayer.ai/attestations/by-call/750defed-2267-45b1-8a8c-74b528aa30ee) | [`22_no_auth_refused.json`](docs/evidence/mainnet-e2e/22_no_auth_refused.json) | Historical `f13efe92` |

The output check is the recorded body next to its attested `output_hash` in [`web/tests/fixtures/attested-hashes.json`](web/tests/fixtures/attested-hashes.json). `node judge/readme-verify.mjs` also checks the recorded `prove` output: a changed body or a changed statement no longer matches. It does not call the worker.

## Current

| Record | What it shows | Attribution |
|---|---|---|
| [identity.json](identity.json) | Live contract v2.7, code hash `3cZsay…`, deploy `6rD2iMs1…`, published worker `62398a8a…`, governance | Team wallet `keyhole-devmo.near` |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Holder-only NEAR withdrawal on the published worker | Source plus the published hash |
| [docs/evidence/ownership-and-limits](docs/evidence/ownership-and-limits/README.md) | Ownership moves with the key | Team test wallets where that file says so |
| [/holders](https://www.getkeyhole.xyz/holders) | Authenticated proof of keys the connected account holds | The connected signer. Not a confidential-content grant. Not verified-external usage |
| Public order census | 1 sealed vault swap and 5 1Click orders | The six rows above. Not six customers |

## Historical

| Record | What it shows | Attribution |
|---|---|---|
| Contract v2.6 hash `6hk2duib…`, deploy `4XrNsFhg…` | Previous wasm | Team wallet |
| Worker `d337e822` | Previous worker. Arbitrary well-formed destinations were allowed then | Historical |
| [docs/evidence/mid-payout](docs/evidence/mid-payout/README.md) | A payout already in flight was not recalled | Historical build `6367401a` |
| [docs/evidence/contract-v2-4](docs/evidence/contract-v2-4/README.md) | v2.4 cost table | Historical |
| Chain-signature tx `7P9VFx4p…` | One earlier MPC signature | Historical. Signing is disabled now |

## Source only

| Record | What it shows |
|---|---|
| `contracts/keys/src/pledge.rs` `tier_loan_cap` | Borrow maxima 0.05 / 0.5 / 5 NEAR. Lending is off, so these are configured maxima |
| `loan_principal_delivered` | Emitted on `claim_payout` or `reconcile_payout` when a loan exists. None is recorded on mainnet while nonce is 0 |
| `judge/live.mts` | Opt-in. It can mint. It is not a passive proof |

A public certificate or a floor note is a viewing right for that page. It is not spend authority, not a dollar price, and not a zero-knowledge balance. See [SECURITY.md](SECURITY.md#viewing-right-and-selective-disclosure).
