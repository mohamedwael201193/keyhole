# Proof index

Six public records are six records. They are not six customers and they are not commercial traction. No completed loan is claimed. Lending is off. The next loan nonce is 0. The owner is still `keyhole-devmo.near`.

Attribution is only what the record itself says. A team-wallet label means the repository already names that wallet as the operator's. External means the record names a different account. Unknown means the record does not say.

## Current

| Record | What it shows | Attribution |
|---|---|---|
| [identity.json](identity.json) | Live contract v2.7, code hash `3cZsay…`, deploy `6rD2iMs1…`, published worker `62398a8a…`, governance | Team wallet `keyhole-devmo.near` |
| [THREAT_MODEL.md](THREAT_MODEL.md) | Holder-only NEAR withdrawal on the published worker | Source plus the published hash |
| [docs/evidence/ownership-and-limits](docs/evidence/ownership-and-limits/README.md) | Ownership moves with the key | Team test wallets where that file says so |
| [/holders](https://keyhole-seven.vercel.app/holders) | Authenticated proof of keys the connected account holds | The signer. Not a confidential-content grant |
| Public order census | 1 sealed vault swap and 5 1Click orders | See each order's own evidence. Not six customers |

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
