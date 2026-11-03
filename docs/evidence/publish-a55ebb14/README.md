# Worker a55ebb14: audit fixes (2026-11-03)

Built from `main` at d5ee413 (PR #80) with `tee/worker/build.sh`: sha256 `a55ebb14df4ebb26f2bcc45767d9ec794466f6debd8ce96a883c93223a80140e`, 708,837 bytes (two builds, same hash).

| Step | Link |
|---|---|
| FastFS upload (expected prepaid-gas revert; bytes served by FastFS hash to the same value) | [`Fs4Kqj7Y…`](https://nearblocks.io/txns/Fs4Kqj7YLmsqozWakfCKH6tQ1oFm4xHW4fkXY6FNvD1i) |
| `add_version` | [`GNqXiicF…`](https://nearblocks.io/txns/GNqXiicFgXQpS5LsYiNRffK6Xhp5W7Yi8EZK2XqKvX8X) |
| Live `info`, attestation 1255082 | [`b0a6eadb`](https://api.outlayer.ai/attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec) ([output](info_b0a6eadb.json)) |

Cost: 0.008455 NEAR from `keyhole-devmo.near` (0.714891 → 0.706436 available).

## Live checks on a55ebb14

- **FullAccess is parsed, not substring-matched.** A function-call key whose only method name is `FullAccess` was added to `keyhole-devmo.near` (tx [`5teDg468…`](https://nearblocks.io/txns/5teDg468qKn28fYL33h8onSPDqUVhvdigueDcCjRWdwZ)). A request signed with it was refused `key_not_owned`: call [`40c02b72`](https://api.outlayer.ai/attestations/by-call/40c02b72-b297-4a9a-9265-751ba826fdf8) ([json](fullaccess_fc_key_refused.json)). The same request signed with the account's full-access key passed: [`013b022a`](https://api.outlayer.ai/attestations/by-call/013b022a-2159-4ec2-bdaf-c878dd73e823) ([json](fullaccess_real_key_accepted.json)). The FC key was then deleted (tx [`6nvu2uQT…`](https://nearblocks.io/txns/6nvu2uQTShdXYrBN3tHnSJgEKZpgEFfhM2CPqEnCtx3c)).
- **chain_sign respects the sale lock.** Key `k5f4750858f328940` was locked for 1 hour ([`f5eb650a`](https://api.outlayer.ai/attestations/by-call/f5eb650a-b3d4-40df-b5f9-086f0b0f08b5), [json](lock_1h.json)); `chain_sign` was then refused `locked` before any `v1.signer` call ([json](chain_sign_while_locked.json)).
- **Mint.** A current holder's `mint` is refused `already_holder` ([json](mint_already_holder.json)). The quota order (id check before `g/mints/{day}` is bumped) is in code and tests; no former holder exists on chain today to replay the audit's scenario live.
