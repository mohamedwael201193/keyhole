# Pair check (off-chain consistency)

For each key, `nft_token` and the owner's `nft_tokens_for_owner` + `holder_tier` are read pinned to one final block (`block_id`). This is an off-chain consistency check of the contract's own views, not on-chain verification. Code: `web/lib/pairCheck.ts`, tests: `web/tests/pairCheck.test.ts`. Captured 2026-11-03: all 5 keys consistent (`2026-11-03.jsonl`).
