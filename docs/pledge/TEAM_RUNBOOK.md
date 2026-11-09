# Two team-operated Pledge endings — offline plan

`node scripts/pledge/plan.mjs` prints public method/argument/deposit plans only. It has no network, key generation, signing or broadcast path. `node --test scripts/pledge/plan.test.mjs` checks the batch envelope. No mainnet operation is executed by this runbook. Source caveats and release gates: [SECURITY.md](../../SECURITY.md#pledge-pilot-release-gates).

## Exact intended parties and terms

Sponsor/contract: `keyhole-devmo.near`; new borrower `kh-borrow-1112.keyhole-devmo.near`; new lender `kh-lend-1112.keyhole-devmo.near`. Abort if either name exists. Create only via approved wallet tools; each initial transfer 0.04 NEAR. Keep all FullAccess keys. Dedicated eligible token ID and current policy remain final preflight inputs, not invented live facts. Assign only a deliberately small team-owned supported account, after verifying title/account continuity. Record all setup transfers separately.

Both sequential loans: principal **0.01 NEAR**, exact repayment **0.0101 NEAR**, term **7200 seconds**, grace **900 seconds**, fixed floor **500000 raw USDC (6 decimals)**, bond **0.009 NEAR**. A floor is not a loss cap: default gives the entire account, including later deposits. Prefer an entire 0.50-USDC reserve if ordinary route minimums/caps permit; stop rather than enlarge capital. Lender must own no key and have no provisional-return reservation at funding and receiver eligibility is rechecked at default.

## Before any money

1. Independent latest-head review and final six CI jobs pass. Normal release binary matches source. Read actual deployed `get_loan_limits`, `get_pledge_config`, `get_control_state`, bindings and provider policy. Source-only/mock support is not a live pass. No unresolved prior operation.
2. Quantify final upgrade/migration/storage separately; this plan does not approve or perform deployment. Verify actual lower confinement, exact terminal sequencing, trusted signer/runtime/canonical authority and old-path negatives before enabling funding.
3. Final native balances, fee/compute quotes, account storage, exit route minimum, token-wide caps/remaining/reset and genuine cooldown are recorded. Every transfer <=0.1 NEAR or <=1 USDC. Aggregate creation+gas ceiling 0.10 NEAR and compute <=1 USDC; actual fees must be known before approval. Existing user bonds/credits are not spendable operating capital.
4. Pin real token, contract/code/worker/policy hashes, fresh chain funding deadline (e.g. chain-now + 10 minutes), nonce, immutable terms and exact signed certificate. No earlier certificate is reused. Certificate observation/expiry <=60s; same-floor refresh only. Check lender preview network responses contain no holder balance/history/session.

## Run A — repayment and both cashouts

Print the offline batch; fill only verified public inputs in an approval record. Open with exact bond. Wait for terminal effective lower freeze and prior pending-zero; obtain/verify the exact certificate. Named lender funds exact principal. Funding creates backed borrower credit **and starts debt immediately**. Borrower separately claims principal; verify finalized native receipt/delta, not just a credit badge. Any unknown callback/outcome stops new sends, not a new operation ID.

Repay exact 0.0101 NEAR before or at `due + grace`. The same local receipt removes default eligibility and books backed lender credit. Lender claims and proves actual wallet delivery. Separately verify ordinary thaw terminal, loan absent, bond credit claim succeeds, cooldown/normal self-exit by borrower succeeds. Measure exact exit route and remaining reserve. No privileged unfreeze, cap reset or synthetic delivery. Only terminally recovered capital is reused.

## Run B — deliberate related-party default and lender self-exit

Only after all A operations are terminal and account reserve/caps/route are rechecked, open a fresh nonce/epoch/certificate with the same tiny terms. Repeat actual principal cashout. Both team parties knowingly accept intentional default; no independent borrower is defaulted for demonstration.

Wait real chain time: `now > due_ns + 900000000000`. At equality repayment is permitted and default is forbidden. Named lender claims to itself only if it still owns no key/return reservation; otherwise authenticated lender redirect to an independently checked empty native receiver. Verify the same custody account, new owner epoch, old-owner/session refusal, actual ordinary thaw, actual cooldown and a tiny in-cap native-holder self-exit. Borrower can separately claim released bond. Report full residual account balance privately to its rightful holder; never call the floor a maximum loss.

## Costs and evidence

Two accounts lock/fund 0.08 NEAR (capital). Current docs estimate 0.007 NEAR creation charge each; final protocol quote determines actual cost. Each opening locks 0.009, recyclable only after confirmed return; principal 0.01 is working capital, repayment 0.0101 includes **0.0001 gross premium, not profit**. Provider/compute/route/gas costs and lock opportunity cost are separate. Net new liquidity from a fresh 0.01 loan is at most 0.001 NEAR after bond alone, before gas/setup; this is a mechanism pilot, not gas-bootstrap/adoption evidence. No quoted future price or guaranteed lender yield.

Save finalized transaction/receipt trees and wallet delivery deltas, provider exact request/body/result IDs, builds/attestations/certificate bytes, chain activation/due/grace, cooldown/caps and a sanitized cost ledger. UNKNOWN money remains a pending liability. No retries, refunds, resolution signer or elapsed-time inference clears it. Proposed start **12 Nov 2026 18:00 Africa/Cairo**, finish **13 Nov 2026 14:00 Africa/Cairo**. Latest start = proof deadline - actual term - grace - actual cooldown - measured settlement buffer; stop if this cannot fit.
