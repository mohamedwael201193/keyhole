# Pledge real-UI sandbox acceptance (candidate; not yet browser-verified)

Production stays pinned to `keyhole-devmo.near` with both Pledge flags OFF. This harness is NOT a mainnet rollout. It uses the normal committed contract Wasm and actual local NEAR transactions, access-key lookups, NEP-413 signatures and FINAL receipts. Custody HTTP, confidential token balances, registry and WASI host are explicit mocks. A provider-mock self-exit is NOT proof of external USDC delivery or live provider confinement.

## Existing local instance

UI: `http://127.0.0.1:3142/pledge?token=k1`; lender: `http://127.0.0.1:3142/pledge/lend/k1`. Fixture server binds 127.0.0.1:3144. Public metadata: `/workspace/near_hackathon/pledge-ui-ready.json`. Disposable accounts: `ui-borrower.test.near`, `ui-lender.test.near`; fixed contract `ui-keys.test.near`; token `k1`. Use separate browser contexts/tabs and the explicitly labelled test-wallet role buttons. Keys stay only in process memory. Never attach a mainnet wallet/key. No :3100 process is touched.

This instance has only backend authentication smoke checks so far; no funded UI ending or final screenshot is claimed. Its temporary chain may be discarded/restarted; do not mix screenshots from different instances/heads without labelling them.

## Reproduce from source (existing dependencies; no npm install needed locally)

1. From `contracts/keys-sandbox`, run `UI_SANDBOX_READY=/tmp/keyhole-ui-sandbox.json cargo test --locked --test pledge serve_ui_sandbox -- --ignored --nocapture`. The public JSON provides its loopback RPC. Borrower/lender payout slots deliberately start unregistered.
2. In `web`, set `NEXT_PUBLIC_PLEDGE_SANDBOX=1`, `NEXT_PUBLIC_PLEDGE_SANDBOX_RPC` to that exact loopback URL, `NEXT_PUBLIC_PLEDGE_LIVE=1`, and `NEXT_PUBLIC_PLEDGE_TRANSACTIONS=1`. Start existing Next on 127.0.0.1:3142 (`next dev --webpack --hostname 127.0.0.1 -p 3142`), or build/start the isolated `.next-pledge-sandbox` production output. A missing/non-loopback RPC fails; no mainnet RPC fallback exists.
3. A desktop worker should drive actual inputs/buttons. On mobile choose the Account & inventory / Loan action tabs; do not hide overflow or shrink a screenshot afterwards. Full inventory/obligations are available in the explicit private sheet.

## Exact browser acceptance

The authored `web/e2e/pledge-funded.spec.ts` runs on CI only when `PLEDGE_SANDBOX_E2E=1`. It performs no page/RPC response stubbing. The new CI step compiles/runs the native harness, builds the isolated UI, and runs that spec once (serial ledger). Normal mainnet-read preview tests skip it.

Both endings must be driven through real UI controls: private inventory → immutable terms (sandbox 120s/30s) → consent → register+open atomically → exact certificate verification → consent → register+fund atomically → principal native cashout (due remains 0 until callback) → Active.

- Repay: deliberately refuse mock thaw, repay full 0.0101 NEAR through UI, observe UnlockPending, restore mock policy, UI retry/reconcile, confirm loan absent and borrower retained title; lender claims 0.0101 and borrower claims 0.009 bond as real native transfers; ordinary self-exit 100000 raw USDC through the production guarded drivers.
- Default: second loan reuses the permanent slots; confirm native delivery; advance ONLY sandbox chain beyond due+grace; UI rejects an occupied receiver; named lender claims to itself; observe new title with failed thaw; old-holder signed private/value requests must fail; finish genuine mock thaw; current holder reads inventory, real epoch-scoped ten-minute cooldown blocks exit; advance sandbox only, authorize fresh inventory, then ordinary 100000 raw self-exit. Borrower claims its bond credit.

Save borrower AND lender at 1440×900 and 390×844 for all 16 key states (ready/inventory, declared offer, verified floor, funded/no debt, native-delivered Active, repay thaw pending/thawed/exit, second offer/verified/funded/Active, default title/thaw pending/cooldown/exit). Mobile captures both deliberate panels; no hidden/clipped content. Requested local destination: `/workspace/near_hackathon/shots_pledge/final/`. CI artifact: `pledge-final`, including `evidence.json`, `native-receipts.json` and fixture logs. Download that exact-head artifact there; never relabel prior preview PNGs.

Every capture asserts no horizontal/vertical page overflow. The native receipt ledger binds actual signer, receiver, ordered actions, deposits/gas and FINAL status. The test also checks borrower/lender native balance increases and old-holder/non-owner negatives. Actual browser execution and final PNG review remain REQUIRED; a compiled spec is not a PASS.

## Production release STOP gates

Independent exact-head contract/worker/UI review; live lower-provider confinement; single pinned nonlegacy worker and audited signing authority; operator/minter payout onboarding; fresh fees; genuine mainnet route/cooldown; and explicit rollout authorization. FullAccess keys remain retained and can bypass contract/worker serialization until separately approved removal. No quote is fabricated: the UI labels same-ledger live comparison unavailable.

The unexecuted mainnet batch is `scripts/pledge/plan.mjs` plus the local lane checkpoint. It uses 0.70 USDC reserve so the first 0.10 exit leaves 0.60 above the second 0.50 floor; only 0.50 initially would break that second loan. New team accounts each get 0.04 NEAR; permanent storage is 0.0032 per role (one batched first action), loan bond 0.009, principal 0.01, repay 0.0101. All future nonces/deadlines/certificates/token/policy/final fee checks remain mandatory unexecuted gates.

Full native pilot accounting also includes the two ordinary worker exits: each minter `begin_value_op` attaches 0.01 NEAR at 35 Tgas, followed by terminal `finish_value_op` (0 deposit, 35 Tgas). Their 0.02 gross attachments are separate capital/storage backing, with excess credited to the minter (not a guessed automatic refund). Optional minter first-slot sponsorship is exactly 0.0032 if final unregistered; other legacy/royalty roles trigger a separately costed STOP. Thus 11 user transactions + 4 worker transactions + at most 1 minter-slot transaction = 16; maximum keys-contract gross attachments 0.077700000000000000000006 NEAR. Gross attachments are not added again to the 0.2032 cash allocation ceiling. Minter-credit cleanup, NFT mint/binding/deployment/storage and any infrastructure are separately approved preflight, NOT silently included in that pilot total.
