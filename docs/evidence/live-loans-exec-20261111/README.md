# Live worker publication — 11 November 2026, Africa/Cairo

Public evidence for publishing worker `3ff0bcad704020e2d3beceb322d7e680e48367afb03cd0c421de6f6c1a783377` on project `keyhole-devmo.near/keyhole` while keeping UUID `p000000000000004b`. Built and executed from main `83ff187312d856b7b80cb555612b4b67f8593bd7`. Lending stayed OFF. No `new`, `migrate`, `migrate_pledge`, or FullAccess key deletion. No signed transactions, secret values, or encrypted secret rows are stored here.

## Reproducible build

From that main tip, `tee/worker/build.sh` produced sha256 `3ff0bcad704020e2d3beceb322d7e680e48367afb03cd0c421de6f6c1a783377` (1,331,880 bytes), matching `identity.json` `worker_candidate` and `docs/evidence/worker-provisioning/candidate.json`. `node scripts/check-worker-candidate.mjs` printed `PASS`.

## Transactions (all FINAL)

| Step | Transaction | Result | Native effect |
|---|---|---|---|
| FastFS chunk 1 | [`D1HQ3VzitDUdJqiR9Bzhkyjvz2aBrgNk4y2CgYjyEZYZ`](https://explorer.near.org/transactions/D1HQ3VzitDUdJqiR9Bzhkyjvz2aBrgNk4y2CgYjyEZYZ) | FINAL, expected prepaid-gas exhaustion (FastFS indexes args; same pattern as the prior 62398a8a upload). **Do not resend.** | ≈ 0.0053547 NEAR fee |
| FastFS chunk 2 | [`BXQ1XVjHcyNhfXRoL2iJMxEF18Fmmk4LkqZdrVYkuPAu`](https://explorer.near.org/transactions/BXQ1XVjHcyNhfXRoL2iJMxEF18Fmmk4LkqZdrVYkuPAu) | Same expected FINAL gas exhaustion. **Do not resend.** | ≈ 0.0015345 NEAR fee |
| `store_secrets` merge (profile `default`) | [`CAjR5zxceETwQW9h7g4aW6GNVde4kWts7AHe8dTbG5R1`](https://explorer.near.org/transactions/CAjR5zxceETwQW9h7g4aW6GNVde4kWts7AHe8dTbG5R1) | FINAL `SuccessValue`. Official CLI merged `GUARDED_WORKER_HASH` and `INTENTS_READ_API_KEY`. Excess of the 0.1 NEAR attachment was refunded (0.09244 NEAR plus gas refunds). | net ≈ 0.00794 NEAR |
| `add_version` + `remove_version` (one tx) | [`2casVEri1dP4J2RH92bLGDjYPq6oseL9jua3NRAQZFs7`](https://explorer.near.org/transactions/2casVEri1dP4J2RH92bLGDjYPq6oseL9jua3NRAQZFs7) | Both calls succeeded. Logs: version `3ff0bcad…3377` added and set active; `62398a8a…` removed with 0.0044 NEAR storage refund. | fee 0.0007337774291352 NEAR (0.0044 deposit refunded) |

FastFS assembly at `https://main.fastfs.io/keyhole-devmo.near/outlayer.near/3ff0bcad704020e2d3beceb322d7e680e48367afb03cd0c421de6f6c1a783377.wasm` returned HTTP 200, 1,331,880 bytes, exact sha256, nonce `1794434041`, 2 parts, and compared byte-for-byte to the local rebuild (`assembly.json`).

## Post-checks (views)

- UUID still `p000000000000004b`
- `get_version_count` = 1
- `active_version` = `3ff0bcad704020e2d3beceb322d7e680e48367afb03cd0c421de6f6c1a783377`
- Owner `keyhole-devmo.near`, pending owner / attestor / minter / staged upgrade hash unchanged
- `lending_enabled` = false

See `versions.after.json`.

## Balances

Contract `keyhole-devmo.near`:

- Before: 6.872881570179188 NEAR (block 224122209, 23:51:17 Africa/Cairo)
- After registry: 6.857318667337235 NEAR
- **Spent this session: 0.015562902842 NEAR**

test_holder2 / test_holder3 / minter balances were not used.

## Stopped: R4-04 canary and live loans A/B

After publication, every live token still has `get_collateral_binding = null`, no pending registration, no loan, and `pledged = false` (`collateral.pre-loans.json`). There is no confined wallet credit to unshield, and no pledge to fund or default. Starting an exact-near-v1 canary or turning lending ON would not have a valid certificate/wallet/USDC path.

The runbook requires a holder-authenticated V2 provision and ≥ 0.70 USDC in the confined wallet *before* the 0.10 USDC canary and the 0.01 NEAR loans. The selected token `k5f4750858f328940` is a historical wallet; if authority audit cannot be substantiated, the runbook says STOP rather than fabricate it. Those steps were **not started**, so they can still be run after a successful provision, and still must finish with lending OFF before 12 November 2026 14:30 Africa/Cairo (or wait until after the separate apply_upgrade / accept_owner window).

Loan B’s lender, when later created, remains **a separate account with new keys** (team-controlled; not independent). No such account was funded in this session.
