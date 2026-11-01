# Ownership, lock, holder limits and cooldown (NEAR mainnet, Nov 1 2026)

Raw worker responses. Each `call_id` has a public attestation at `https://api.outlayer.ai/attestations/by-call/<call_id>`; `./judge/2-attestations.sh` style checks apply (the output hashes to the attested `output_hash`).

| file | call | result |
|---|---|---|
| c09_A_withdraw.json | 440c2378 | A (holder) withdraws 0.003 USDC: ok |
| (tx) | [3AhjtyUN…](https://nearblocks.io/txns/3AhjtyUNx9T5QCgphV9niUYFFY6si5y1zLo39e8LHkDS) | key transferred A → B |
| c11_A_replay_after_transfer.json | e805f050 | A signs again: `not_owner` |
| c13_B_withdraw.json | a4867e19 | B (new holder) withdraws: ok |
| c14_B_replay.json | c3a9839f | same signed request again: `replay` |
| c19_B_lock.json | 98b27188 | B locks the key for sale: ok |
| c20_B_withdraw_locked.json | 075287b5 | withdraw while locked: `locked` |
| (tx) | [HbrJmfpz…](https://nearblocks.io/txns/HbrJmfpzpiQEqPyoz1QdvL2iYBVLBAvbAZfTtxGbnkXU) | key back to A |
| c01_A_status.json | ad9f8102 | A status, tier caps only |
| c02_A_limits_cut.json | 38ae4d84 | A cuts caps to $0.002 / $0.005: applies at once |
| c03_A_withdraw_over_holder_cap.json | ec00a7aa | withdraw right after the key came back: `cooldown` |
| c04_A_limits_raise.json | 8e142cce | raise request: stored as pending for 24 h |
| c05_A_status_after.json | 992a72dc | status shows the pending raise |
| c07_A_quote_over_holder_cap.json | 396bb6dd | quote above the holder cap: `over_cap_per_tx` |
| c11_A_status_final.json | c247eaf3 | final status |
