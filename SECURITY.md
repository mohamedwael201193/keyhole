# Security

KEYHOLE moves a confidential trading account with an NFT. This file is the security summary: what we protect, how each threat is handled (STRIDE), the invariants and the test that checks each one, an audit checklist, and the limits we know about. Narrative detail on ownership changes is in [THREAT_MODEL.md](THREAT_MODEL.md); the contract review is in [docs/audit/keys-contract.md](docs/audit/keys-contract.md).

Report a problem privately to the repository owner. Please do not open a public issue.

## What we protect

| Asset | Where it lives | Who may use it |
|---|---|---|
| Confidential balances and trade log of a key | OutLayer custody wallet, API key sealed in TEE storage under the token id | the current NFT holder only |
| The TEE minter key (`015a0259…`) | generated and kept inside the enclave | the worker code with hash in `tee/worker/DEPLOYED_SHA256` |
| The key NFT | `keyhole-devmo.near` contract (NEP-171) | its owner |
| Holder policy (caps, cooldown, lock) | TEE storage, bound to token **and** owner | the holder who set it |
| Site secrets (OutLayer payment key, 1Click key, NEAR AI key) | Vercel sensitive env vars | server routes only; never sent to the browser |

## Trust assumptions

- Intel TDX and the OutLayer runtime run the published wasm. Anyone can check this per call: `/verify` re-runs 19 Intel DCAP checks and the report_data binding in the browser, and `./verify.sh <call_id> --rebuild` rebuilds the wasm.
- NEAR RPC returns the true owner of a token. The worker reads `nft_token` on every signed request.
- Not trusted: this website, the gateway route, the browser, the agent that holds a key, and any text the AI is shown.

## STRIDE

| Threat | Example | Control | Proof |
|---|---|---|---|
| **S**poofing | Someone signs as the holder | NEP-413 / EIP-191 signature checked in the TEE; signer must own the NFT now; a full-access key is required | `valid_signature_passes`, `other_key_fails`, `account_mismatch_fails`, `eip191_recovers_the_fixed_vector_and_rejects_a_tamper` |
| **S**poofing | A request signed for another app | recipient must be `keyhole` | `wrong_recipient_fails` |
| **T**ampering | Edit the amount or destination after signing | the signed payload covers op and params; any change breaks the signature | `tampered_message_fails`; mainnet attack log in `docs/evidence/prompt-injection` (edited recipient → `bad_signature`) |
| **T**ampering | Edit the key's history | events are hash-chained and the head is signed by the TEE minter; `/key` re-checks every link | `provenance_chain_verifies_and_rejects_a_tampered_owner`; web `keylog.test.ts` |
| **T**ampering | Swap the worker code | attestation carries the executed wasm hash; must equal the FastFS file and the published version | `/verify`, `verify.sh`, CI `worker` job rebuild |
| **R**epudiation | Holder denies a trade | every answer is attested; signed answers carry `bind` = request sha256, nonce, account, token | `/verify` binding panel; evidence files in `web/public/evidence` |
| **I**nformation disclosure | A new holder reads the old holder's rows | row detail is returned only to the account that wrote it; others see hashes | `provenance` op; `/key` shows counts only |
| **I**nformation disclosure | The site logs AI prompts | `/api/ai` stores nothing and sends `no-store`; the model runs in a TEE with a fresh nonce | `web/app/api/ai/route.ts`, `ai.test.ts` |
| **D**enial of service | Spam the enclave | per-holder and global per-minute limits; per-IP limits on site routes | `rate_limit_per_holder`, `global_rate_limit`; limiter tests |
| **E**levation of privilege | A function-call key or agent drains funds | full-access key required; per-trade and daily caps; raises wait 24 h; candidate worker restricts withdrawal to the verified current holder's own NEAR account (see the deployed boundary below) | `over_cap_per_tx_refused`, `holder_cut_applies_now_and_raise_waits_a_day`, `holder_withdraw_pays_only_self_on_near`, `holder_withdraw_rejects_another_receiver`, `holder_withdraw_rejects_non_owner_and_missing_token`, `holder_withdraw_rejects_old_holder_after_transfer`, `holder_withdraw_rejects_mismatched_chain_even_with_valid_external_address` |
| **E**levation of privilege | Old holder keeps access after selling | owner read on every call; 10-minute withdraw cooldown for a new owner; seller lock | `transfer_then_old_signature_is_not_owner`, `withdraw_waits_after_a_transfer_only_for_the_new_owner`, `seller_lock_binds_only_the_owner_who_set_it` |
| **E**levation of privilege | Anyone mints or changes the minter | contract: minter-only mint, owner-only setters with 1 yocto, private init | contract tests `non_minter_cannot_mint`, `old_minter_cannot_mint`, `set_minter_only_owner`, `init_is_private` |

## Invariants and the test for each

Randomised invariant tests run many random sequences per CI run (`tee/worker/src/tests.rs`).

| Invariant | Test |
|---|---|
| Spend never exceeds the per-trade or daily cap, including after rollbacks | `invariant_caps_never_exceeded_across_random_trades_and_rollbacks` |
| A signed nonce is accepted at most once | `invariant_each_signed_nonce_is_accepted_at_most_once` |
| A transfer cooldown binds only the latest transferee | `invariant_cooldown_binds_only_the_latest_transferee` |
| A lock binds only its owner and ends on time | `invariant_lock_binds_only_its_owner_and_only_until_it_ends` |
| Holder limits stay inside the tier; raises wait a day | `invariant_holder_limits_never_exceed_tier_and_raises_wait_a_day` |
| A payout already in flight when the key moves completes to the holder who signed it while owning the key; that holder's later requests are refused `not_owner`. A key moved before the send aborts the send | `invariant_a_payout_settles_only_if_its_signer_owns_the_key_at_auth_and_at_settle`, `random_transfer_and_withdraw_never_pays_the_previous_holder`; mainnet run in `docs/evidence/mid-payout` |
| NEP-199 payout always adds up to the sale balance | contract `nep199_payout_conserves_balance` |
| A holder's best tier follows the token on transfer | contract `holder_tier_is_best_and_follows_transfer` |

## Audit checklist

- [x] Contract: init private, mint minter-only, setters owner-only with 1 yocto, royalty ≤ 10 %, token id 1–64 bytes, beat batch ≤ 50, one key per account on mint and every transfer path, `migrate` self-only and once.
- [x] Contract: standard NEP-171 transfer rules (owner or approved, 1 yocto, no self-transfer) and events; NEP-178 approvals cleared on every transfer.
- [x] Worker: every state-changing op authenticates, checks freshness and nonce, reads the owner on chain.
- [x] Worker: amounts parsed as integers; USD caps checked before any external call; spend rolled back on failure.
- [x] Worker source: withdraw destination is the verified current holder's own NEAR account on NEAR; the signed request must match it exactly. Caps, cooldown after transfer and listing freeze still apply. See the candidate boundary below.
- [x] Secrets: none in the repo (CI `hygiene` job scans); site keys are server-only Vercel env vars.
- [x] Reproducible build: pinned toolchain, path remapping, hash checked in CI against FastFS.
- [x] Attestation: report_data recomputed from the attested fields; DCAP chain to the pinned Intel root.
- [x] Intel collateral checked in the browser: PCK and Root CA CRLs, TCB Info, TDX module and QE identity, signatures to the pinned Intel root ([`web/lib/pcs.ts`](web/lib/pcs.ts)).
- [ ] No third-party audit yet.

## Scope notes, and why they fit the design

- **The enclave is the custodian, by design.** The OutLayer operator runs the service, but balances and trades are sealed by Intel TDX, so the operator cannot read them. That is the privacy promise: the chain shows who holds the key, never what the account holds. Every reply carries a quote you can check in the browser on `/verify`.
- **The key moves by plain transfer.** The contract supports NEP-178 approvals (capped at ten); transfers and `nft_transfer_payout` work, and ownership is re-read before every swap or withdraw, so the account always follows the NFT, even mid-payout ([evidence](docs/evidence/mid-payout/README.md)).
- **Cross-chain legs are third parties, shown honestly.** 1Click and bridges are outside the enclave; `/settle` lists every real order with its final status, including refunds and failures.
- **Two kinds of limits.** The tier's daily spend counter belongs to the key (`cap_id(token_id)`), so moving a key between accounts never resets the day's spend. Holder-set caps, the lock and the transfer cooldown are bound to the key and the holder who set them, so a buyer is not trapped by the seller's settings and a seller cannot dodge a cooldown by passing the key around and taking it back.
- **Browser DCAP and Intel PCS scope.** `/verify` runs 19 Intel TDX DCAP checks on the quote (structure, signatures, QE binding, certificate chain to the pinned Intel root, validity dates, report_data) and 12 checks on Intel PCS collateral: the PCK and Root CA revocation lists, the TDX TCB Info for the machine's FMSPC, the TDX module identity and the TD Quoting Enclave identity, each signature verified in the browser against the pinned Intel root, with TCB levels matched by Intel's rules ([`web/lib/pcs.ts`](web/lib/pcs.ts), [tests](web/tests/pcs.test.ts)). Intel sends no CORS headers, so the bytes pass through `/api/pcs`, which forwards only fixed Intel URLs; it cannot change a result without breaking a signature. The status is shown as Intel reports it (UpToDate for the published call; the independent `dcap-qvl` verifier agrees: [`docs/evidence/pcs`](docs/evidence/pcs/dcap-qvl_7882f97a.json)).
- **NEAR AI replies.** `/ask` checks the nonce and signer in report_data, both hashes and the ECDSA signature; NVIDIA GPU evidence is passed through for NEAR AI's verifier.

- **Tier on a second key.** Limits follow the holder's best tier, so a holder of a Gold and a Bronze key trades both accounts at Gold caps. Only Bronze is minted today ([review R5](docs/evidence/red-review/README.md)).
- **Swap at the moment of sale.** A swap the old holder signed can still run if the transfer is not final when the enclave re-reads ownership. The value stays in the account the buyer now holds; withdraws wait out the cooldown ([review R6](docs/evidence/red-review/README.md)).

- **Beat key.** The function-call key on the TEE minter can call only `beat` on the keys contract, with no deposit, until its 0.05 NEAR gas allowance is spent. If it leaked, the worst case is extra `nft_metadata_update` events for existing tokens; no mint, transfer, minter change or fund movement is possible. The owner removes it with `del_beat_key`.

## Independent review

Two-pass review with a NEAR AI Cloud TEE model, each reply's signature and Intel DCAP quote checked, every finding triaged by hand: [docs/evidence/red-review](docs/evidence/red-review/README.md). Four real findings (R1 to R4) are fixed with regression tests.

## Product scope

- The mint page issues a Bronze key only ($1 per trade, $5 per UTC day, 6 calls per minute). Silver, Gold, and Legendary are shown as finishes. The worker already has tier 2 ($10 / $50, 12 per minute) and tier 3 ($100 / $500, 30 per minute). This site does not mint those tiers.
- The vault form trades USDC and wNEAR only.
- A quote from the vault uses confidentiality `basic`. The worker also accepts `advanced`.
- The website gateway allows `info`, `provenance`, `status`, `quote`, `mint`, `account`, `balance`, `history`, `swap`, `withdraw`, `lock`, `prove`, `limits`, and `pnl`. `provenance` needs no signature and returns only owner, kind, and event hashes. `copy` and `sweep_minter` return `bad_op`. Copy-trading is the CLI, not the vault page.
- Fund, quote, trade, withdraw, balance, and history each ask for their own signature. The signature is not a transaction. After a trade or withdraw, the page asks for another signature to re-read the balance. Declining that second signature leaves the trade or withdraw card up and does not leave "You declined the signature."
- Withdraw pays the connected account only.
- If the enclave is offline or the payment key is missing, Vault and Mint show the offline state and do not send the signature.
- The site is English only. There is no language switcher.
- The 30-step mainnet log in the README (§9) was recorded against worker `f13efe92`. The worker serving the site is `d337e822` ([add_version tx](https://nearblocks.io/txns/BWQxEoSg3b6XHdk4iooAneoBJM7EtP83HTrvYXpdBQi5)); before it `cc8d2fa8` ([add_version tx](https://nearblocks.io/txns/Epaz3aMAk1WuLGaMuHKCACvGU981uEr4zUqzyep1zfi6)), `a985fd87` ([add_version tx](https://nearblocks.io/txns/A1o8882hpjZmBr56hhDop236MrSFtEnMfNt9nEZwo4sG)), `ebeb6a34` (published and rolled back, [add_version tx](https://nearblocks.io/txns/MG7pGVSNjFDz85yqrAA9stN4yyXECYfYLDmCgYE4gyq)), `94c355ff` ([add_version tx](https://nearblocks.io/txns/EA7S1TeVnMF1v5FthV4ffQf9NYXfGJTtzo4ZRp25ZBjy)), `cff9fd3c`, then `a55ebb14`, which includes the review fixes R1 to R4.
- Prices come from the NEAR Intents token list. An asset with no price is named as unpriced. USDC is treated as $1 only when that list has no price for it.

## Chain Signatures (`chain_sign`)

`chain_sign` asks `v1.signer` for a signature from the key's derived secp256k1 address (`keyhole/key/<token_id>`). The worker does not parse the 32-byte payload, so it cannot price it in USD and the tier caps do not apply. The guards that do apply, in the enclave (live since build `a55ebb14`; a locked key's `chain_sign` refused on mainnet, see `docs/evidence/publish-a55ebb14`): the holder must sign the request (full-access key or EIP-191), the key must not be locked for sale, the post-transfer cooldown must have passed, and each key can request at most 5 signatures per UTC day (each one costs the minter gas). The public gateway does not expose the op. The derived addresses hold no funds; treat any balance sent there as outside KEYHOLE's spend caps.

## One key per account

The contract refuses a mint or a transfer (`nft_transfer`, `nft_transfer_call`, `nft_transfer_payout`) to an account that already holds a key. While a key is out on `nft_transfer_call`, its sender also counts as a holder until `nft_resolve_transfer` runs (`pending_return_count`), so a key the receiver sends back never lands next to a second one. The sandbox test `transfer_call_race_is_closed_on_v2_2` drives that exact interleaving with a receiver contract that tries to hand the sender a second key inside `nft_on_transfer`. Caps follow `holder_tier`, and the worker refuses any signed request that does not name `params.token_id`.

## Royalty

`config.royalty_bps` is 500. `nft_payout` and `nft_transfer_payout` return a 5% split to the treasury; the marketplace that called `nft_transfer_payout` pays it. A plain `nft_transfer` or `nft_transfer_call` carries no price, so it pays no royalty (as in every NEP-199 contract); a marketplace that ignores NEP-199 is not forced to pay.

## Contract upgrades

`keyhole-devmo.near` holds a full-access key, so its owner can deploy new code. v1 to v2 added `migrate()`; v2.1, v2.2 and v2.3 changed code only. v2.3 (live since 2026-11-07) caps approvals at 10 per token; its evidence is in [`docs/evidence/contract-v2-3`](docs/evidence/contract-v2-3/README.md). v2.4 adds the built-in sale; v2.5 (candidate release wasm, not deployed) adds owner epoch, value-op admission and sealed pledge state with a separate one-time `migrate_pledge` for lending/recovery configuration; the abandoned desk surface is removed. Every deployed version is in `contracts/keys/release` with its sha256, CI rebuilds the source to the newest one, and `judge/1-contract.sh` compares the on-chain `code_hash` with `contracts/keys/deployed` (still v2.4 until the approved redeploy).

## Sessions (one signature, then no wallet popups for 30 minutes)

**Connect and unlock in one popup.** NEAR wallets connect through `@hot-labs/near-connect`, the connector the NEAR docs use for wallet login (https://docs.near.org/web3-apps/tutorials/wallet-login). Its `connect({ signMessageParams })` signs in and signs one NEP-413 message in the same wallet prompt (https://github.com/hot-dao/near-selector, README "Initialize connection to wallet and sign in"). That message is the `session` request. Because it is built before the account is known, a `session` request (and only that op) may leave `account_id` empty; the enclave then uses the NEP-413 signer and still requires that the public key is a full-access key of that account, exactly as the backend-auth doc describes. The session binds to the first key that account holds. MetaMask is not offered by near-connect with message signing, so EVM accounts keep the EIP-191 path: connect, then one `personal_sign` to unlock.

This follows NEAR's documented backend-auth pattern (https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet): the user signs one NEP-413 message with a nonce and recipient, the backend checks the signature and that the key is a full-access key of the account, and then issues a session. Here the backend is the enclave.

- **Start:** the wallet signs `{op:"session", params:{max_usd_micro, ttl_ms?, scope?}}` (NEP-413; EIP-191 for MetaMask). The enclave runs the same checks as every other signed op (signature, full-access key, freshness, single-use nonce, current holder), then returns a random 32-byte `session_token`. Only `sha256(token)` is stored, together with the grant `{account, token_id, exp_ms, max_usd_micro, scope}`.
- **Use:** each request carries `{token, message:{op, account_id, ts_ms, params}, nonce}`. The enclave checks (`authenticate_session` in `tee/worker/src/main.rs`; pure checks in `lib.rs`; 40 tests in `src/session.rs`):
  - the grant exists, is not revoked and has not expired (30 minutes at most);
  - the op is in scope: `status, quote, account, balance, swap, copy, history, pnl, limits (lowering only), dashboard, session_revoke`. The previous build 94c355ff also lists `withdraw`; build a985fd87 removes it (see below);
  - the account and token in the request match the grant;
  - freshness (±5 min) and a single-use nonce;
  - the account **still holds the key**, read live on every call, so a sale ends the session;
  - the grant's spend cap, on top of the unchanged tier and holder caps.
- **End:** the Revoke button (and sign-out) sends `session_revoke`.

Caveats:
- The token is a bearer credential, like any Web2 session. Anyone who has it can act within its scope until it expires, is revoked, or its cap is used up. That includes script injection on the site, and the site's gateway, which relays the request body (bodies are not logged). The token cannot raise limits (a raise needs a wallet signature and still waits 24 h), lock, prove, mint or use chain_sign.
- Historical build94c355ff accepted session withdrawals with a holder-only destination restriction. This is historical behavior, not the current arbitrary holder-signed destination policy. Current sessions cannot withdraw.
- **Live since a985fd87 (still in cc8d2fa8 and d337e822):** `withdraw` is removed from `SESSION_OPS`. A withdraw needs a fresh NEP-413 or EIP-191 signature, and a session token gets `session_scope`. The site already asks the wallet for that signature, and its gateway refuses a session-scheme withdraw. The site changes that go with this worker are in this repository and reach the live site on the next site deploy.

## Worker hardening (live since a985fd87)

These apply to the live build `d337e822`, to `cc8d2fa8` and to `a985fd87`, which first had them. The build `94c355ff` does not have them.

- A swap with no `min_amount_out` is floored at 1% below a fresh 1Click quote (`DEFAULT_MAX_SLIPPAGE_BPS`, `derive_min_out`). A client `min_amount_out` of `0` is refused with `bad_params`.
- A swap or withdraw that is refused before the send gives back its session budget and its day's spend. A send that fails for good gives them back too. A send still pending or under review keeps them (`charge_spend`, `Charge::settle`).
- Nonce records are kept; they are not pruned on the call path. Build ebeb6a34 pruned them with a storage key listing, and on OutLayer that listing blocked every signed call until the 60-second limit; it was rolled back to 94c355ff (set-active-version call, tx `ArXzjsWPs9ii119Q3zy3dViPERaKF26rE7Q1xnLmZrEW`). See [docs/evidence/publish-cc8d2fa8](docs/evidence/publish-cc8d2fa8/README.md) (the live build), [docs/evidence/publish-a985fd87](docs/evidence/publish-a985fd87/README.md) and [docs/evidence/publish-ebeb6a34](docs/evidence/publish-ebeb6a34/README.md) (rolled back).
- A NEP-413 `callbackUrl` is part of the signed payload when the wallet signed one. The site sends it only when the signature verifies with it.
- `chain_sign` needs a fresh wallet signature, refuses while the key is locked or in the transfer cooldown, and is capped at 5 per key per UTC day.

- Replay check runs before the rate limits (`admit`), so replays cost no rate budget.
- `chain_sign` counts toward the daily quota only after a signature that recovers to the key; a failed MPC call costs nothing.
- `withdraw` re-reads key ownership after the custody move and reports `needs_review` if the key changed hands meanwhile.
- `quote` refuses a key locked for sale, and pins `recipient` and `refund_to` to the signer.
- `add_beat_key` / `del_beat_key` check the signer against the keys contract `config().owner`, read live.

Tests: `tee/worker/src/p2harden.rs`.
## Google / email sign-in (Privy)
- Follows NEAR's Privy tutorial, "Direct Privy" tab (https://docs.near.org/web3-apps/tutorials/privy) and near-examples/hello-privy: `@privy-io/react-auth` login, a NEAR embedded wallet (`createWallet({ chainType: "near" })`), and a near-api-js `Signer` whose `signBytes` calls Privy `signRawHash`.
- Trust: Privy's embedded-wallet custody model (key shares split between the user's device and Privy's infrastructure) is a third-party trust assumption. Anyone who controls the user's Google / email login, together with Privy, can sign for that account. Users who want sole custody use a NEAR wallet or MetaMask.
- Third-party code: Privy's SDK runs in our page (npm-pinned through package-lock). We do not load the near-connect sandbox executor or host a `/sign` page for this path, so no runtime-fetched script is involved.
- The enclave treats a Privy account like any NEAR account: NEP-413 signature with a full-access key of the implicit account (`is_full_access`), freshness, single-use nonce. No new trust in the TEE.
- A new implicit account must receive a little NEAR before it exists on chain; until then the worker rejects its signatures (no access key yet). We do not sponsor accounts.
- Allowed origins in the Privy dashboard: keyhole-seven.vercel.app and localhost for development only.

## Continuity

- If the OutLayer payment balance runs out, a later paid worker call stops. GET `/api/health` does not spend that balance and does not report it. Attestations, FastFS wasm and on-chain state stay public and verifiable. The page strip shows that availability was not probed.

## Design decisions and trade-offs

Each entry gives the decision, the reason for it, and the mitigation. Each one is a limit that remains in the design. Nothing here is hidden elsewhere in the repository.

### 1. Admission barrier + settlement epoch (handover safety)

- **Decision.** Before any external custody dispatch the settler must `begin_value_op` on-chain for that token. Every ownership-changing path (`nft_transfer`, `nft_transfer_call`, `nft_transfer_payout`, `nft_buy` / `transfer_key`) refuses while a value-op is pending. Independently, the worker stamps value-moves with the key's owner epoch (`nft_settlement_epoch`); a settle whose stamp no longer matches is refused `epoch_void` (or `needs_review` after a custody return). Listing freeze (including wet `quote --execute`) still blocks new value-moves while listed.
- **Why.** An epoch (or a last-second owner recheck) **cannot recall** an Intents deposit, external transfer or Agent API job that already committed ([NEAR Agent API grants](https://docs.agentsonintents.com/integration/agent-api/overview); KEY_VALUE_IDEAS §3). The required pattern is a contract-side admission permit acquired before dispatch, with ownership locked until reconcile. Epochs complement the barrier; they do not replace it. NEP-178 is NFT transfer approval only ([NEAR NFT standard](https://docs.near.org/primitives/nft/standard)); a function-call key's allowance is gas, not a principal spend cap ([NEAR access keys](https://docs.near.org/protocol/accounts-contracts/access-keys)).
- **Mitigation.** v2.5 stores epochs under prefix `E` and pending ops under `Vc`/`Vo` (no migrate). Worker must call begin/finish around dispatch (follow-up PR; stop before publish). **Incomplete until** every still-callable money-moving OutLayer worker version also enforces the permit — inventory and disable or pin before claiming the barrier complete on mainnet. Residual: committed external payouts cannot be recalled. Historical mid-payout on build `6367401a` (2026-11-01): [docs/evidence/mid-payout](docs/evidence/mid-payout/README.md).

### 2. No NEAR sub-account per key

- **Decision.** Each `token_id` has one OutLayer confidential custody wallet, held inside the TEE. There is no NEAR sub-account.
- **Why.** A NEAR sub-account would need an access key, and someone would hold that key. Here the keys never leave the enclave.
- **Mitigation.** The holder cannot take the key out, and the account is not a NEAR account that a wallet can open directly. OutLayer runs the custody service, so it is a third-party custody API and part of the trust base. Keep balances small: the caps and locks are enforced inside the enclave, but they do not stop an attacker who runs outside it (see [README §8](README.md#8-security-model)).

### 3. The contract account is not locked

- **Decision.** `keyhole-devmo.near` holds two full-access keys, and its owner can change the contract. There is no multisig and no timelock, and the account is not keyless.
- **Why.** Each contract version so far is a code deploy signed by a full-access key (v1 to v2.4 live; v2.5 release ready). The multisig and timelock are not built yet.
- **Mitigation.** Every deployed version is in `contracts/keys/release` with its sha256. CI rebuilds the source, and `judge/1-contract.sh` compares the on-chain `code_hash` with the committed wasm. The key list and the purpose of each key are in [README §8](README.md#8-security-model).

### 4. Intents solvers see the pair and amount

- **Decision.** Swaps run through NEAR Intents 1Click with `confidentiality` set to `basic` or `advanced`.
- **Why.** Solvers need the asset pair and amount to quote the trade. The solvers still see them.
- **Mitigation.** The `advanced` setting is available, and the checks on mainnet use small amounts because Intents has no testnet. Each settled order in the evidence is under one dollar.

### 5. Advisory checks and copy trading

- **Decision.** The counterparty check is advisory and is not enforced inside the TEE. Copy trading exists only on the CLI and MCP.
- **Why.** A check cannot prove that an address is safe, so ALLOW is not safety. Copy trading needs a person to confirm the trade.
- **Mitigation.** `block` stops the call before anything is signed. `warn` needs a code typed on the operator's own terminal (`/dev/tty` or `CONIN$`). The code is never written to stdout or into an MCP result. The web gateway refuses `copy` with `bad_op`.

### 6. The threat model was written after the code

- **Decision.** The contract and worker code were first committed on 2026-10-28 (`66f7070`). [THREAT_MODEL.md](THREAT_MODEL.md) was first committed on 2026-10-31 (`701faf4`), and [docs/TRANSFER_THREAT_MODEL.md](docs/TRANSFER_THREAT_MODEL.md) on 2026-11-03 (`4736e9c`).
- **Why.** The track asked for the threat model first. It was not written first.
- **Mitigation.** Each control in the transfer threat model maps to a named test and, where one exists, to a mainnet call (the table in [README §5](README.md#control-on-transfer)).

### 7. /ask checks are partial

- **Decision.** The browser checks the nonce bindings, the signature over the exact request and response bytes, the model, the Intel DCAP chain of the model's TDX quote, and that every NVIDIA GPU report echoes the nonce. It does not check the NVIDIA certificate chain or the GPU measurements.
- **Why.** Those checks need downloaded evidence that the browser does not fetch.
- **Mitigation.** The evidence is checked with [NEAR AI's verifier](https://docs.near.ai/cloud/verification/cloud-api/model-attestations). The `/ask` answer is not tied to a trading account.

### 8. Earned tiers can be farmed

- **Decision.** A tier counts settled swaps and volume from the key's own trade log.
- **Why.** The tier is computed from that log, so the key's own trades are the only input.
- **Mitigation.** A tier can only rise: the contract refuses a lower value. A holder who trades back and forth to reach a tier pays fees and spread on each trip. The tier is real on-chain history, but it does not show that the trading was useful to anyone.

### 9. The listing freeze covers value moves and wet quotes

- **Decision.** Before a value move (withdraw, swap, copy, chain_sign) or a `quote` with `execute: true`, the enclave reads the key's listing. A dry quote stays allowed while listed. The listing is re-read immediately before the custody send.
- **Why.** A wet quote returns a deposit address; obtaining that address is not itself proof of a debit. It is still conservatively classified as value-capable for admission, and funding/settlement requires separate evidence.
- **Mitigation.** The check-then-act window is one custody round-trip. A listing that appears after the second read is seen by the next request; an epoch bump from a sale voids the settle stamp.

### 10. Transfer events declare NEP-171 1.0.0

- **Decision.** The custom transfer helper emits the `nft_transfer` event through the standards crate's `NftTransfer` struct, which declares version 1.0.0. The `nft_metadata_update` event declares 1.2.0.
- **Why.** The event struct comes from `near-contract-standards`, and it declares 1.0.0.
- **Mitigation.** The transfer event is to be aligned to 1.2.0 in the next contract release.

### 11. Operator keys

- **Decision.** `keyhole-devmo.near` currently holds **two FullAccess** keys and one FastFS FunctionCall key (read-only RPC `view_access_key_list`, 2026-11-09):
  - FullAccess `ed25519:7N1fLo9MssKJoiL3kqBHX1zhmqjPxyDuzG5Fk583mxzF` — deploy / owner ops (kept offline per README §8).
  - FullAccess `ed25519:8NP9x5eFZic4E8cL4Pq8NLoHwB5VG1tbhWPnHSPE2bdj` — owner's Meteor wallet.
  - FunctionCall `ed25519:FNe2aYtzNZ3FicPYdCjxgWuVMTf29NK2F1UzoFSsQ6h1` → receiver `social`, methods `__fastdata_kv` / `__fastdata_fastfs` (FastFS), allowance 1 NEAR.
  The TEE minter `015a0259…ac443` holds one FullAccess (enclave-generated) and one FunctionCall limited to `beat` on `keyhole-devmo.near`. There is no multisig and no timelock. `config.treasury` is the contract account itself. Live count is re-checked on [/verify](https://keyhole-seven.vercel.app/verify).
- **Why.** Deploys so far are FA-signed (v1–v2.4 live; v2.5 release wasm ready, not redeployed). Classic FunctionCall keys **cannot attach NEAR** ([docs](https://docs.near.org/protocol/accounts-contracts/access-keys)), so payable `nft_mint`, `register_collateral` and storage-funded `begin_value_op` cannot move to a pure FC minter; FC can cover only non-payable methods such as `beat`, `finish_value_op` and `nft_set_tier` once separately approved/provisioned.
- **Mitigation.** Do **not** delete FullAccess keys from mainnet without a verified recovery plan and separate approval of exact current keys/commands. The prepared pledge recovery method below is treasury-only; it cannot restore upgrade authority or operate the minter. No key-change command is executed by this code/test PR. The abandoned desk surface and its ledgers are removed, not a future recovery mechanism.


## Pledge v2.5 authority graph — prepared, not deployed

| Authority | Allowed path | Cannot legitimately do | Residual trust / evidence gate |
|---|---|---|---|
| Holder / borrower | NEP-413 worker request; open immutable named-lender terms; exact repay; cancel unfunded offer | Transfer/list/approve/swap/withdraw while pledged or token transfer-call pending | Worker admission must cover every value-capable path; a UI badge is not custody confinement |
| Named lender | Fund a fresh contract-verified certificate; claim native credit; default to eligible receiver | Change floor/terms, read sealed balance as visitor, seize before grace, bypass one-key rule | Floor is raw USDC only; willing lender chooses economic terms |
| Pinned TEE minter / attestor | Mint; admit/finish reconciled operations; bind exact collateral wallet/policy; sign fixed floor | Rebind wallet, replace attestor through a setter, finish ambiguous external settlement safely | Old versions sharing its storage MUST be retired; certificate signature alone is not measured-code proof |
| NFT contract | Fixed-ABI calls to immutable configured custody contract; confirm controller+locked policy digest/version+freeze; verified thaw after resolution | Generic arbitrary call, policy deletion/update, upgrade or DeleteAccount through recovery | Provider/keystore enforcement and old signed orders/delegates require live proof |
| Existing operator FullAccess on NFT/project account | TODAY can replace contract, publish a bypass build and act as controller directly | Cannot honestly promise operator resistance while retained | Key removal/retirement/policy cutover need separate explicit approval; no such action is performed here |
| Contract owner role | Enable/disable **new funding/offers** and bounded royalty administration; minter setter works only before pledge migration | Disable repayment/default/credit claims through lending switch; change fixed recovery identity through a setter | Removing FA only helps when no other owner-role route retains override capability |
| Fixed recovery account | After December2,2026 02:00 Africa/Cairo, recover an explicit treasury ledger amount to ITSELF | Move loan principal, user credits, refundable bonds/listing deposits, stored vault assets or NFT; upgrade code or change authority | New treasury funding and future self-directed sale royalties are explicit; pre-existing unclassified native capital remains unclassified |
| OutLayer provider / platform governance | Runtime, keystore, confidential routing and policy service | Not claimed cryptographically powerless by this app | Platform governance/shared-master/routing assumptions remain even after app FA removal |

### Liability conservation and recovery

Native liabilities include pending registration deposits/bonds, refundable loan bonds and all available/in-flight pull credits. Funding atomically credits principal to the borrower in DisbursementPending with due_ns=0. Active debt starts only on the exact successful genuine native principal cashout callback. Failed cashout restores credit without debt; UNKNOWN keeps the loan and pending amount locked with no debt clock. Exact repayment creates lender credit before thaw. Claims reserve before sending; only genuine private host callback success consumes liability, and genuine failure restores credit once. Available credit and a pending payout share one prepaid permanent account ledger without overwriting credit accrued during a pending transfer. Unknown native outcomes remain locked, never restored by time/signature/balance inference. Listing deposits, storage and the operating reserve are excluded from treasury. Policy reconciliation requires the exact command terminal callback plus matching authoritative policy state; no later command begins while either stage remains pending.

Native liabilities include pending registration deposits/bonds, refundable loan bonds and all available/in-flight pull credits. Funding atomically credits principal in DisbursementPending with due_ns=0. Only the exact genuine successful native principal cashout callback starts Active debt; definite failure restores borrower credit with no clock. UNKNOWN stays pending with no clock, even if outside observations suggest delivery. Exact repayment creates lender credit before thaw. Claims reserve before sending; only genuine private host callback success consumes liability, and genuine failure restores credit once. Available credit and a pending payout share one prepaid permanent account ledger without overwriting credit accrued during a pending transfer. Unknown native outcomes remain locked, never restored by time/signature/balance inference. Listing deposits, storage and the operating reserve are excluded from treasury. Policy reconciliation requires the exact command terminal callback plus matching authoritative policy state; no later command begins while either stage remains pending.

Treasury recovery is bounded twice: by provenance-tracked `treasury_available` and by native account balance after all those reserves. A time gate alone never makes an active loan's money treasury. Legacy balance is initialized as **zero recoverable ledger**, not “balance less code storage.” Future built-in sale royalties directed to the contract are provenance-tracked when earned; external-market transfers and pre-migration royalties are not assumed attributable. No new lending fee is invented. Any future request to attribute legacy operating capital requires its own auditable migration design. All generated callbacks have private access guards; ordinary callers cannot manufacture success.

There is intentionally **no timelocked upgrade path** after FullAccess removal: an upgrade could replace the escrow rules after the date while user obligations still exist, defeating treasury-only recovery. This makes final code/worker administration potentially immutable and demands a separate pre-removal longevity/reconciliation audit. No promise of instant fixability or emergency admin seizure is made. Upgrade deployment must be quiescent: no legacy transfer-call receipts or old worker jobs still pending; pre-v2.5 in-flight receivers cannot retroactively acquire token-specific locks.

### Economic and privacy consent

This is bilateral short liquidity in NEAR while retaining USDC exposure and not revealing exact vault balance. Swapping is an alternative, often simpler/cheaper. The minimum is voluntary public information; the exact balance stays sealed until actual ownership changes. A true floor does NOT prove USD value, debt coverage, demand, profit or solvency. NEAR/USDC FX and USDC depeg risk remain; no price oracle, partial liquidation or automatic surplus return exists. **Default forfeits the whole confidential vault, not merely the disclosed minimum. Ordinary worker routes reject new swaps and withdrawals during the pledge**, including unrelated assets; this does not cancel pre-existing resting orders, signatures or grants. Borrower/lender UX must disclose these facts before signatures. Pre-signed orders/delegates/keys can invalidate collateral eligibility; no lending on opaque legacy authority assumptions.

### Verification status

Unit and sandbox proofs validate application accounting and local receipt semantics, with a labelled mock provider. They do not validate live custody freeze, version retirement, absent delegates, gateway cutover or operator key removal. Mainnet lending stays disabled until the separately approved confinement rollout is complete. No code-only test may be relabelled as that live proof.

### Oracle-free callback safety and explicit liveness limits (source candidate)

There is no terminal attestor/key, truth-selecting reconciliation ABI or external recovery service. The prior trusted design permitted false failure statements to re-credit already-paid native money; nonce signatures did not fix that economic authority. Its ABI/vector are removed. The remaining floor signer cannot reconcile native payments or NFT outcomes. Floor domain is now `KEYHOLE_SEALED_LOAN_V3_DELIVERY`, incompatible with earlier credit-time activation certificates.

Normal financial callbacks inspect only genuine host promise status. Policy reads are bounded32KiB; the NFT resolver bounds returned bytes before allocation to32bytes, reserves50Tgas and binds settlement to the outbound owner epoch. Missing callback is never evidence of failed payment. Unknown native cashouts, treasury payouts and unproven failed registrations stay locked. This prevents the reviewer's repeated1.1NEAR payout attack but does not solve all callback-loss liveness; **do not call the candidate keyless-complete or ready for FullAccess removal**.

Only provisional NFT title has permissionless timed restoration:300seconds, exact pending epoch/original sender/current receiver/reservation, no loan or admitted operation. Acceptance already committed locally is final; late callbacks cannot unwind newer title. Approvals/reservation settle through the same bounded path. External receiver-side economic actions are not rolled back, so consideration must await final local acceptance or conditional escrow. This semantic is explicit, not an oracle for receiver outcomes.


The earlier proposed provider-generation/provisioning-metadata extension is not used. The documented Boolean provider ABI instead requires strict local serialization, described below. A missing action callback remains UNKNOWN; no matching Boolean snapshot or invented metadata can clear it.


## Pledge pilot release gates

Source only: funded lending stays off until independent latest-head review, source/release parity, current six CI jobs and real provider confinement/terminal sequencing pass. Mock freeze support is not provider proof. Storage is remeasured after integrating custody serialization, including repay/default/cancel and unknown native cashouts, not a bound on future ABIs. Every storage/schema/policy change needs new measurement/bond review. Bonds remain full liabilities and treasury reserve protects both liabilities and required storage. Code, operating capital and permanent registration bonds are separate. The 0.02-NEAR binding bond is unchanged. The default path retains a bounded first owner-epoch entry (117 bytes for a 64-byte token); it is not a refundable loan record. The separately retained binding reserve covers permanent binding/epoch metadata in the measured fixture; do not assume every lifecycle returns the account byte-for-byte to its pre-title-change baseline.

The candidate implements V2's delivery-bound debt clock: funding leaves DisbursementPending and due_ns=0. Only the exact payout nonce's genuine native-success callback activates debt; unrelated earlier payouts, failed transfers and UNKNOWN callbacks do not. Lost success callbacks can indefinitely delay debt even after actual delivery: this conservative liveness trade-off must be disclosed to lenders. No balance observation, oracle or timeout can substitute for the callback. Source changes do not approve public lending.

A 0.01-NEAR pilot still needs 0.009 NEAR upfront bond plus gas/setup/registration/provider/route costs; net after bond alone is only 0.001 NEAR. This is not gas-bootstrap/adoption proof. Team subsidy/default is mechanism evidence, not demand, net lender profit or loan superiority. Floor is not a loss cap/NAV; default takes the whole account and later deposits, no surplus return. Recovery depends on native identity, supported asset/route, minimums/caps/cooldown/provider availability. Keep unrelated funds out.

Offline batch includes unresolved final token/nonce/deadline/certificate inputs and cannot sign/broadcast/create keys. Fresh actual fees/account availability/provider state/deployment shortfall and exact approval are required before value actions. Budget or refundable credit does not authorize spending. Keep FullAccess keys; no terminal oracle, timed refund, production failure fixture, clock acceleration, cap reset, privileged thaw, key/credential change or hidden retry.

The public upstream provider offers only `freeze_wallet(wallet_pubkey)` and `unfreeze_wallet(wallet_pubkey)`, with no generation fence. This candidate therefore uses strict **one-outstanding-command serialization**, not the prior invented provider extension. It persists the exact local sequence before dispatch, rejects duplicate/same/opposite redispatch while busy, records terminal completion only in the genuine private action callback, then validates controller/locked/version/digest/desired frozen state. A terminal action that leaves the wrong Boolean state may be retried only after that read completes; the new dispatch gets a fresh local sequence. Late/duplicate callbacks and old reads cannot settle a new command. The on-chain `policy_generation` name is retained for source-candidate layout compatibility but is LOCAL bookkeeping, not provider enforcement.

If the action callback is lost, **UNKNOWN is permanent in the ordinary API**: neither a fresh Boolean snapshot, elapsed time, alleged generation, owner/attestor assertion nor an opposite command can clear it. If only the subsequent read fails AFTER terminal completion was persisted, read-only reconciliation is safe. The same conservative rule applies to registration: an unknown store receipt cannot be recovered from a matching policy or invented nonce/deposit metadata. Its forwarded liability and unready binding remain locked. Incident reconstruction and separately reviewed approved repair may be necessary; autonomous fault liveness is not claimed. No generation-support extension is required or asserted live.

Freeze does not cancel pre-existing resting orders or external signatures. The worker still requires complete terminal request/order/approval inventory and a sealed exact-wallet authority audit; the Boolean and a passing local mock are not sufficient collateral proof. Retained FullAccess can directly send provider commands or replace this serializer; the code's sequencing invariant does not defeat that administrative power. Upstream source compatibility is not deployed-bytecode parity or live confinement evidence.

Epoch cooldown is stored independently of provenance, in immutable per-contract/token/epoch cells before exit authorization. Storage/read failure, corrupt state and clock regression fail closed. A previously unseen nonzero epoch starts a full ten-minute wait from first final-chain observation, conservatively later than the actual transfer; a clean-store migration can therefore add latency. These cells grow with observed epochs and need an eventual safe retention policy; they are never pruned or timer-stolen in this release. This path never mutates token-wide daily spend history. Old public event contents/commitments are unchanged by this lane.



### Candidate self-exit destination boundary — not live

Standard candidate withdrawals require fresh full-holder authorization, derive only the authenticated current NEAR holder on the NEAR chain, and reject any different requested destination. Unknown chain/identity mappings fail closed; no Solana/Bitcoin ownership proof is invented. Sessions cannot withdraw. The private-transfer route and durable provider POST boundary enforce the same policy, so a hidden signed `to` is not a bypass. Already-submitted legacy requests may still be reconciled without authorizing another send. Lower provider recipient enforcement remains unproven: this is not an operator-proof destination firewall.

The CURRENT LIVE source permits arbitrary well-formed freshly signed destinations. Historical malformed/tampered attack examples are not proof of this new policy, which has not been published. Before activation, every affected holder needs a supported real self-exit proof. Generic arbitrary-digest MPC signing is disabled in the candidate, with an explicit final owner/epoch settle gate on that rejected entrypoint. Previously issued signatures cannot be recalled and foreign balances/allowances are outside collateral. Provisional title grants no confidential reads or sessions. No live publication/retirement/authority change has happened.

### Round-three native-payment inventory and historical boundary

The v2.5 candidate no longer fire-and-forgets any native user refund: sale consideration, listing-bond returns on sale/unlist/transfer/stale cleanup, buyer excess or stale-buy attachment, external royalty, mint excess, approval excess/revocations/cleared approvals, and admitted value-operation excess all become `get_payout_credit` claims. Active listing bonds remain separately reserved until conversion to credit. These operations do **not** promise immediate wallet delivery. The caller claims with one yocto; private native-result callbacks settle an immutable account/nonce/amount. Failed payout restores available credit once, success consumes only that pending amount, and unknown stays reserved without timeout. Credit accrued while a payout is pending remains separate. No redirect recipient, external outcome signer, or callback-loss refund is introduced.

Before `migrate_pledge`, isolated aggregate liability/nonce keys back the same account ledgers and claims. Migration imports both (including an in-flight payout) and clears only those temporary aggregate keys, not account credit or pending records. This is not a migration from an already-deployed earlier v2.5 candidate. No amount from historical v2.4 failed/unrecorded pushes can be reconstructed from account balance; prior receipt/refund obligations must be independently reconciled before any production recovery rollout. The captured-state test is not proof of absence of historical off-ledger claims. This PR does not authorize migration or treasury withdrawal.

Native dispatch inventory after this candidate: (1) `claim_payout` and `recover_treasury` reserve immutable pending records before native transfer; (2) collateral provisioning records forwarded deposit before provider call and keeps unknown outcome reserved; (3) other custody/receiver/approval callbacks carry zero native value. Legacy SDK refund-push helpers are no longer used by public mint/approval/transfer entry points. Payout-ledger growth is separately prepaid as described below; callback gas and other protocol storage still require operational funding; the code-size/storage quote is sandbox-only and does not authorize funding. Native callback-loss financial liveness remains unresolved.

A missing/stale NFT resolver record conservatively returns `false`; it never infers acceptance from the current owner. This preserves a timeout rejection even after a newer provisional transfer. A valid committed first acceptance still returns `true`, removes its reservation, and cannot be timed out afterwards. Receiver economic side effects are not rolled back; counterparties must observe the final boolean and use conditional consideration.
## Event commitment version boundary

V2 secret per-event blinding hides low-entropy plaintext from public commitment guessing, not ownership, timing, kinds, published minima or previously revealed facts. Legacy unsalted v1 hashes and old owners' knowledge cannot be made secret retroactively. Authorized openings are intentionally sensitive; opening one row does not disclose another row's nonce. The provider and retained administrative authorities remain trusted. The encrypted Store interface and WASI entropy adapter are source-tested here; no live worker publication is implied.

A v2 cutover pins the legacy array as an immutable encrypted prefix. Old worker versions must be independently retired from the canonical authority before protected finance is enabled. Event persistence errors stop response signing; they do not undo an already-dispatched external operation. Resume/reconcile its original journal, never submit a new money operation merely to obtain a history row. The append retry identity is private and binds the admitted request nonce or ownership phase, not low-entropy plaintext/timestamp equality. Reconciliation must preserve that original operation identity; it must never dispatch new money merely to regenerate an event. Reusing an event identity with changed detail is rejected. No timer lock is stolen and no mutable log array is overwritten by the v2 writer.

## Protected sale source boundary

Protected sales are disabled by default and are not a deployed product claim. Enablement requires zero configured royalty and initialized pledge configuration, plus independently reviewed canonical-worker authority, lower confinement, terminal prior operations and fresh USDC observation. The contract verifies a trusted attestor's Borsh bytes; it does not read the confidential balance or prove solvency, market value, net recovery, or measured worker execution. This PR supplies contract settlement and source/runtime tests, not a production certificate issuer or live provider proof. Gifts and legacy unprotected listings do not carry the protected minimum guarantee.

Sale freeze/thaw calls use the provider's documented `freeze_wallet`/`unfreeze_wallet` ABI, with no invented generation parameter. The exact action callback must be genuine, and the matching controller/locked/version/digest/holder policy read must complete before any retry or cancellation can dispatch another command. Terminal action alone keeps the command busy; lost, malformed or unavailable reads remain pending and allow read-only reconciliation, not a new freeze/thaw. Duplicate action callbacks cannot enqueue another read. A lost action callback remains UNKNOWN and blocks retry, cancellation and new control phases; a Boolean view cannot clear it. Tests model these calls, not the provider keystore or deployed-code parity. Existing pledge registration/generation support inherited from the base still has its separately documented rollout gates; integration with the guarded worker lane must be reviewed before any enablement.

Seller consideration becomes backed credit before native dispatch. A known failed pull payment restores it once; successful delivery consumes it once; either world's lost payout callback remains pending without timeout refund, outcome signer or duplicate spend. A paid sale is not rolled back by a later thaw or cashout failure. The refundable 0.02 NEAR sale bond is retained as a liability through thaw, then credited back to the original seller. Opening requires the seller's separately prepaid permanent payout slot, and checks actual sale-record growth plus conservative headroom against the refundable bond; the bond is not a storage charge or operating capital. Retained FullAccess and owner administration still permit code/configuration replacement. Zero royalty is an explicit release setting, not immutable zero costs forever.

Reference semantics: [NEP-199](https://github.com/near/NEPs/blob/master/neps/nep-0199.md), [NEAR callback failure](https://docs.near.org/smart-contracts/security/cross-contract-calls/callback-failures), and [provider wallet source](https://github.com/out-layer/outlayer/blob/main/contract/src/wallet.rs). Source inspection is not live bytecode parity.


Custody command serialization is enforced by the reviewed contract and worker API, not by removal of administrative authority. Retained FullAccess keys can deploy replacement code or directly act as the controller account and bypass that sequencing. Keys remain retained under the approved plan; this source does not claim operator-proof confinement or authorize key removal.

### Round-four payout-storage budget and onboarding (undeployed candidate)

Every new `Pc` account ledger requires `register_payout_account(account_id: Option<AccountId>)` with exactly `payout_storage_cost()` attached. `None` registers the predecessor; any account may sponsor another. The payment is a **nonrefundable storage charge**, not payout credit, a treasury-recovery attribution, or a deduction from any refund. Underpayment, excess payment and duplicate registration reject the entire receipt without overwriting existing available/pending credit. There is no unregister or storage-charge withdrawal method. This candidate is source/sandbox only; registration is not a mainnet action in this PR.

The fee prepays 320 bytes at the host storage-byte price. A 64-byte account's largest Borsh ledger (available + one immutable pending nonce/amount) uses 151 bytes including trie overhead. The two pre-migration aggregate/nonce keys add at most 130 bytes **globally**, so even the first account's worst combined 281 bytes fits its own fee. Registration checks measured initial growth plus the 24-byte future pending expansion and this 130-byte allowance. Separate payable fees, not gas rewards or existing reserves, cover new identities. The deployed runtime's storage-price/overhead assumptions must be rechecked if the protocol or serialization changes.

Empty registered slots remain permanently after successful cashout. Their capacity is reusable; creating or clearing pending payouts and accruing credit cannot allocate another account record. This deliberately avoids a refundable storage bond that would lose backing on delivered-but-lost callbacks. A lost callback still locks its pending amount, without arbitrary failure inference. New sale/refund/loan credits cannot silently create a slot. Dust is not discarded: an unregistered buyer attaching price plus 2 yocto is rejected atomically (including title/listing/deposit), or separately registers first and gets the full 2-yocto claim. Exact-price buyers without a refund need no slot unless another credit-producing operation requires one.

**Rollout/integration STOP gate:** onboard minters before mint/admission/provider dispatch, sellers before listing, approvers before approvals, borrowers before opening and lenders before funding; any royalty recipient receiving a pull credit must be registered before a sale (including a self-treasury before pledge initialization; after initialization self-royalties use the treasury ledger). Legacy approval/refund beneficiaries must register before a new operation that frees their storage; failing synchronous calls revert rather than lose money. Transfer-call schedules an approval refund only for a permanently registered original owner, so callback-time unregistered-credit failures are not introduced. Workers, CLI and frontend need registration/claim UX and explicit fee consent before rollout. Third-party sponsorship is optional, not permission to spend user funds.

Only the already-deployed v2.4-to-candidate upgrade is exercised. An older *undeployed* v2.5 review candidate could contain unbonded `Pc` records; this code does not retrospectively label or charge those records. Do not deploy over such a state without separately funding/reviewing its storage obligations and preserving all credits/pending payouts. Before/after-pledge migration in this candidate retains the same prepaid slots, aggregate liabilities and nonce continuity. Historical unrecorded push failures remain a separate reconciliation boundary, not confiscated or reconstructed from balances. No production deployment, migration, top-up or FullAccess removal is authorized.
The candidate self-exit policy is stated once, above: withdrawals are NEAR-only to the current holder. EIP-191 is a signing method for holder authentication, not a withdrawal destination on an EVM chain.


- **Decision.** `keyhole-devmo.near` has two full-access keys (deploy key and the owner's Meteor wallet key) plus a function-call beat key that can call only `beat`. The minter account's full-access key is generated and kept inside the TEE. There is no timelock or multisig yet. Live count is re-checked on [/verify](https://keyhole-seven.vercel.app/verify).
- **Why.** The reasons are those in entry 3. The key list and the stated purpose of each key are in [Trust detail](#trust-detail-moved-from-the-readme).
- **Mitigation.** The beat key is a function-call key that can call only `beat`, with a 0.05 NEAR allowance, and the owner revokes it with `del_beat_key`. The deploy key is described in the repository as kept offline and never on the website or in the worker.


### Pledge preview/client ABI gate

The removed terminal-payment attestor has no field or callable path in the preview client. The remaining attestor key certifies only the fixed collateral floor; it cannot choose native payout truth. `DisbursementPending` means backed principal credit with no debt clock. `Active` requires the exact successful genuine native principal cashout callback. Freezing/Offered/DisbursementPending/UnlockPending must not be rendered as an active unpaid debt. The preview stays flag-OFF while complete borrower/lender transactions, exact storage/gas builders and custody release gates undergo separate review. This client cleanup is not a live-product acceptance or a deployment.



## Holder-only withdrawal candidate boundary (H195-01)

The candidate worker re-reads `nft_token` with final finality before custody access or spend reservation. The signer must be that owner, `chain` must be exactly `near`, and `to` must equal that account; shape-valid external addresses are not exceptions. The custody request derives its receiver from the authenticated holder, not arbitrary request fields. The existing final-owner/epoch gate still runs immediately before dispatch. Unit regressions cover another receiver, non-owner, missing token, old holder after a transfer, and mismatched chains. A source-wiring test checks the final read, guard placement and derived receiver; it is not a live custody test.

`begin_value_op` has no separate receiver parameter and already requires the supplied authenticated `owner_id` to equal the live NFT owner at admission. Pending value-ops block ownership changes. New contract tests exercise non-minter admission, an old holder at the new epoch after a real NFT transfer, and transfer blocking until terminal finish; the existing other-owner admission negative remains in place. No contract storage layout or receiver ABI change is needed for this finding.

This local candidate is NOT a publication or deployment. Published worker `d337e822` historically allowed signed arbitrary destinations, as the release evidence records. Its hash/identities and historical evidence are deliberately unchanged. The integrated candidate's ordinary withdrawal invokes `begin_value_op` before provider dispatch and `finish_value_op` only through the terminal reconciliation driver. The durable journal validates the same holder-only destination at POST; pending admission blocks title changes. Post-send drift remains `needs_review`, not proof of cancellation or rollback. Live policy enforcement and retirement of old worker authority remain separate rollout gates; local integration does not prove deployed provider confinement.

The web builder/readonly receiver are convenience restrictions, not an authorization boundary: the worker independently enforces them. Direct legacy CLI callers must provide the same holder NEAR account and `chain=near`; cross-chain payout is intentionally refused (cross-chain swaps/deposits are unchanged). Supported asset/provider availability still applies: this is not proof that every external-chain asset can be withdrawn as a NEAR token. The v2.5 `nft_buy` flow now records seller proceeds and refunds as pull credits: prepaid payout registration and a later `claim_payout` are required for credit recipients. Native delivery is separate from sale/title settlement. No mainnet withdrawal, wallet access, deployment, identity rewrite or spend was performed for this fix.


## Integrated release boundary

Ordinary and durable withdrawals are NEAR-only to the freshly authenticated current holder, not arbitrary destinations or EVM self exits. The generic detached-signing path remains disabled. Integration is local-only; no deploy, funding, secret reads, authority change or version retirement was performed. Lenders may remain locked if borrowers never claim principal; an unknown native cashout or missing policy action callback has no automatic liveness recovery. This is a deliberately conservative economic tradeoff, not a launch-ready claim. Loan and protected sale concurrency must remain mutually exclusive under the contract admission barrier.


### Integrated-stack online verification limitation (2026-11-10)

The candidate's local PR-CI gates are separate from the public service's live readiness. At 08:31 Africa/Cairo, the deployed health endpoint returned online=false with reason=service_unfunded. That online claim remains a real FAIL in [validation.json](docs/evidence/integration-stack/validation.json). It was not rewritten as a pass. GET `/api/health` is now passive: it does not call OutLayer and a skipped or stale attestation is not a fresh online pass. The web health module has no paid provider dispatcher. POST permanently returns 405 with `Allow: GET`, regardless of old flags, body words, payment-key presence, replay or concurrency. The HTTP compute budget is always zero, across instances; no in-memory limiter is relied on to authorize spending. Any future paid operator verification must be a separately approved operator action, not a public health call. The previous public approval literal and reusable opt-in path were removed; regression tests mock all fetch calls and require zero dispatches. This change did not run that probe, did not top up a balance, and does not know whether the service is funded now. Compute funding is not contract-storage funding, minter gas, or loan principal. No balance top-up, deployment or paid worker call was authorized or performed by this integration run. The two documented intentional contract refusals are checked for their exact failure messages, not mislabelled as successful transactions. Full online readiness needs a separately authorized operational action and another verification; offline checks do not establish it.

## Qualifications moved from the README

**No NEAR sub-account.** Each `token_id` maps to one custody wallet held inside the OutLayer Intel TDX enclave. A NEAR sub-account would need an access key, and someone would hold that key. Here the keys never leave the enclave. The account is not a NEAR account a wallet can open directly. It runs only through the enclave.

**Threat model written after the code.** The contract and worker code were first committed on 2026-10-28 (`66f7070`). [`THREAT_MODEL.md`](THREAT_MODEL.md) was first committed on 2026-10-31 (`701faf4`), and [`docs/TRANSFER_THREAT_MODEL.md`](docs/TRANSFER_THREAT_MODEL.md) on 2026-11-03 (`4736e9c`). The track asked for the threat model first.

**Signed record.** The public `record` statement shows what the enclave read on that call. The minter's signature is the trust point. It is not a complete audit of the trade log. Evidence: [`docs/evidence/signed-record`](docs/evidence/signed-record/README.md).

**Browser verifier transcript.** The e2e test [`verify: the default page checks the published d337e822 info call`](web/e2e/site.spec.ts) drives the page. A saved full browser transcript of info call `dc3668db` (build `d337e822`) is not in the repo. The last full recorded browser run was `0847b924` (build `cc8d2fa8`). The public attestation for `dc3668db` is still the identity block's info call.



### Integrated client recovery and ordinary payout rollout

The candidate browser, session and CLI/MCP value requests bind a final uncached token owner and decimal-string `owner_epoch` **before signing**. Session grants persist their returned epoch; A→B→A drift requires re-unlock, not refreshing an old signed envelope. The hosted gateway relays fresh-holder-authenticated `reconcile_value_op` for the original journal only; sessions cannot reconcile. It validates exact certificate parameters and applies a separate six-per-minute IP budget in addition to worker token limits. This is source/local regression evidence, not a deployed confinement claim.

Operation identities survive reload/tabs without persisting signatures or amounts. The authenticated status route can recover a chain-admitted journal after transport loss; it does not revive unadmitted attempts. Provider terminal facts and the original event context are immutable. Successful or definite-failure private history/provenance is finalized **before** admission is released; a failed history write leaves the same operation recoverable, never redispatches another payment. History, record aggregates, PnL and earned progress all consume that projection; another holder cannot obtain the writer's detail/opening.

Ordinary seller/buyer/refund onboarding exposes the exact 320-byte nonrefundable slot fee separately from listing bond, gas and proceeds. Native cashout in Vault requires a separately signed `claim_payout`; an in-flight payout stays locked on UNKNOWN. The interface labels delivery only after a FINAL receipt tree with a genuine successful callback. Definitive missing-method feature detection retains v2.4 behavior; network errors never downgrade it. The worker minter preflights its own permanent slot before spending mint quota or dispatching a mint and refuses with an operator-onboarding instruction; it never silently purchases/sponsors that slot. The operator must explicitly register minter and any external treasury/refund recipients in the separately approved release batch and may use the CLI payout command to inspect/claim credits.

Protected lending and protected sales remain OFF pending actual authority/version retirement and provider confinement evidence. Source guards cannot revoke already-published workers. Funding is **not** native delivery: a borrower who never claims principal can lock lender capital indefinitely, without a funding-deadline escape. A lost dispatched payout callback also remains UNKNOWN indefinitely. Future lending activation requires explicit lender consent to both risks; no timeout refund, fabricated audit record, new signer or FullAccess removal is introduced here.

## Two-sided Pledge UI release gate

This source is not complete first-class funded-loan acceptance. Public certificate transport and canonical signature/binding verification are implemented; the displayed certification expires conservatively. Native-credit wallet dispatch has persisted-before-wallet state, exact final-receipt binding and an anti-replay dispatch-block anchor. A lost hash/unknown callback remains blocked, not automatically retried or refunded. Storage corruption or a missing final dispatch anchor stops wallet dispatch. These tests are not a browser-wallet or live provider proof.

`NEXT_PUBLIC_PLEDGE_TRANSACTIONS` is a separate default-OFF write gate. The candidate now wires private complete at-risk inventory and the open/fund/cashout/repay/default/thaw/ordinary-exit wallet lifecycle, including exact persisted redirect resumption. Writes remain disabled by default; both funded sandbox browser endings and visual/network evidence are STILL acceptance gates, not completed merely by implementation. UI/API transport must be independently reviewed with the final worker and contract. The V3 contract candidate starts debt only at the exact genuine successful native principal cashout callback; failed/UNKNOWN delivery accrues no debt. The UI must not infer delivery from funding or a transaction hash. Older deployed candidates do not implement this ABI.

A verified Ed25519 floor is a pinned trusted-attestor statement, not proof of measured worker execution, attestation-chain enrollment, absence of retained authority, live provider confinement or full-account value. Verify the exact signed output's runtime/signer provenance independently before lending. Custody serialization is enforced by the contract/worker API; retained FullAccess keys can directly act as the controller or replace code and bypass it until removal. Keys remain retained under the approved plan; no key action is authorized here.

The economics model is verified with injected test quotes, not live confidential forward/reverse quotes. Current quote integration is absent, so the actual page shows Comparison unavailable at this size. A foreign/public-ledger quote is not a confidential-ledger quote. Fixed costs, lock/default/provider/availability risks and future income are not zero or guaranteed. Public floor is not NAV, LTV or maximum loss. Team-operated examples are not organic demand or net-profit evidence. Visiting/anonymous lenders use public projection only. After a genuine default changes title, the new current holder may explicitly sign a private inventory read. Ownership and epoch are rechecked; private balances are not stored in shared caches or localStorage. Full authenticated network/cache/log privacy inspection remains an integration acceptance gate.

### Permanent payout storage in the first action (candidate #184 `92da286`)

The client reads final `payout_account_registered` and exact `payout_storage_cost`. A missing slot adds registration (20 Tgas) before the intended loan action (200 Tgas), one atomic same-receiver transaction/one wallet confirmation, never a silent sequential fallback. Fee consent is one explicit line: the charge is permanent, nonrefundable and reusable, separately shown from principal, repayment, the refundable loan bond and gas. Unknown status/cost fails closed. The current tested charge is 0.0032 NEAR per account; at 0.01 principal and 0.009 bond, a first-ever borrower has -0.0022 NEAR incremental liquidity before other costs. The comparison explicitly includes this charge once or remains unavailable when its quote is unknown.

A sponsor can create the slot between preflight and wallet submission. The unconditional registration/action batch then fails atomically, not half-successfully. Retain its exact failed transaction hash and persisted ordered action list, verify the original FINAL receipt and refresh registration. Registered=true means onboarding is already satisfied: a **new manual** intent skips registration and pays no second slot fee. Never silently replay a paid batch or infer failure from elapsed time. Tests cover both wallet-adapter action shapes, ordered batch receipt binding, failed-hash retention and fresh registered-state preparation. Separate normal-WASM contract tests cover register+open/register+fund at 220 Tgas, atomic rollback and sponsored action-only retries. They are not a human wallet/browser proof; the complete funded lifecycle release gates above remain.

### Isolated UI sandbox fixture

The explicit `NEXT_PUBLIC_PLEDGE_SANDBOX=1` test build permits only a validated loopback RPC and fixed `ui-keys.test.near` contract. Its disposable native wallet adapter signs only in-process sandbox accounts and calls the same wallet batch/receipt pipeline. No user/mainnet key is read or exported. Production ignores the fixture RPC, pins the original mainnet contract/RPC, and its sandbox endpoint returns 404. The harness binds 127.0.0.1 only and enforces fixed method/account/receiver/gas/deposit allowlists. Custody HTTP, registry and WASI host are labelled mocks; tests do not establish live provider confinement, external token delivery or runtime attestation. Chain fast-forward is a sandbox-only testing facility, never mainnet debt/cooldown manipulation.

Private inventory fails closed on missing/truncated/changing/duplicate pages or malformed amounts, includes unpriced assets and pending obligations, and uses the same settled-request semantics as the funding certificate. A failed request without exact never-executed proof remains an obligation. A current-holder signature is required; final ownership/epoch/loan/binding are reread after observations. Ordinary exit preserves native admission, real epoch-scoped cooldown, self-destination and caps. UNKNOWN exits persist; reconciliation never creates another withdrawal.

### Pledge UI uncertainty, consent and freshness

Wallet rejection/abort text is not proof that a transaction was never broadcast. After wallet invocation an ambiguous operation retains its exact persisted intent as `UNKNOWN`; it cannot be resent automatically. A matching FINAL receipt (including its dispatch-height bound) is required to reconcile it. Without a recoverable original hash, the UI intentionally remains blocked; elapsed time is not a release condition. Only local pre-wallet validation emits the explicit `preSend` marker.

Storage consent is scoped to the displayed account, contract and exact charge, reset on quote/identity changes and compared with the newly prepared batch just before dispatch. Concurrent sponsorship can still make an otherwise approved registration batch fail atomically; reconcile that original receipt and manually prepare an action-only retry, never a second automatic charge.

A refresh start/failure revokes the client read lease. Old/out-of-order reads cannot re-enable financial actions, and dispatch rechecks the displayed read generation and a 10-second monotonic freshness bound after preflight awaits. These are browser-side safety gates, not replacements for contract ownership, nonce, certificate, policy or payout checks. An RPC can be unavailable or dishonest under the existing RPC trust assumption. Remembered loan resolutions are presentation state, not an independently verified historical index or authorization; without an observed resolution the terminal label remains neutral. Unit tests cover these guards; funded browser endings and exact-head provider integration remain separate acceptance gates.

### PR194 R3 browser coordination and recovery boundaries

- These are cooperative browser guards, not an authorization boundary against a malicious same-origin script or edited storage. Per-intent records are reserved under Web Locks, retained before wallet invocation and normally updated/deleted only by matching the exact captured record and owner-session token. A receipt-verified FINAL native operation has the narrower cross-session resolution exception documented below. Storage events notify other tabs. Secure-context Web Locks are required; unsupported browsers fail closed rather than using an unsafe localStorage lock emulation. The owner token survives same-tab reload/redirect in sessionStorage; loss of that session does not prevent exact FINAL native-receipt recovery; an uncertain operation without a recoverable original hash or proof still remains blocked rather than permitting a guessed replacement payment. Provider-exit continuations are not adopted on the basis of a native receipt. Legacy ownerless records remain blocking and can be adopted under the lock through an exact-record recovery update. Close older-version tabs before upgrading; old clients do not understand the new per-intent format.
- A freshness failure before the withdrawal worker is called preserves an immutable, retryable original exit. A fresh signature can be regenerated; signed auth is not persisted in localStorage. The continuation consumes pending auth only after a durable continuation/dispatch marker exists. A storage failure must not deliberately consume available in-memory auth; after reload a locally unsent intent can regenerate its signature. Explicit discard is limited to locally unsent signature/retry states; the immutable intent ID is part of the signed message, so a late signature for a discarded operation cannot bind to even an identical-fields replacement. The production redirect parser verifies the exact pending message/nonce and optional signed callback URL before publishing auth, and never consumes a newer challenge on a mismatched callback. Legacy unbound callbacks require a fresh signature, not an UNKNOWN resend. UNKNOWN/Pending dispatched exits never gain a timeout-based retry or discard button.
- Refreshes are single-flight within the surface, paced from completion, with 4-second normal polling, bounded error backoff (up to 30 seconds), a 15-second aggregate deadline and transport cancellation. The 10-second executable lease is measured from request start, not aggregate completion. A successful read that takes more than this observation window is rejected with a recoverable error; slower receipts do not mint a fresh lease over earlier owner/clock observations. Independent final-chain views are still not a common-block atomic snapshot, nor proof of a trustworthy RPC. Contract/worker ownership, epoch, nonce and policy checks remain mandatory.
- Expected account and the current fee/read-generation assertions cross the asynchronous wallet-routing boundary and are checked immediately before invoking the wallet. A returned missing/mismatched signer is UNKNOWN, retaining any returned hash for reconciliation rather than reporting success or pretending the wallet was never invoked. A transaction already signed/broadcast cannot be undone by this browser check; redirect outcomes still require original FINAL receipt binding.
- `pledge-review-r3.spec.ts` mounts the actual shared component with mocked wallet/worker/read transports, uses real browser storage/Web Locks and two real tabs, and exercises both configured viewports. It is NOT funded sandbox acceptance, human-wallet evidence, external USDC delivery or live custody-confinement proof. The separately scoped funded native result is recorded below; a remote exact-head CI result and real-provider/rollout review remain separate gates. Production write gates and existing custody disclosures are unchanged.

### Funded native sandbox CI fixture finality

The opt-in loopback UI harness now anchors certificate templates and inventory observations to a finalized block, rather than near-workspaces' default optimistic head. Production certificate future-time, exact-template and signature checks are unchanged. Its transaction response reports the actual disposable native signer and receiver. The funded acceptance waits for the original cashout's successful FINAL receipt and completed payout callback before measuring delivered balance; zero backed credit by itself is not delivery. Grace and the full ownership cooldown are advanced against the actual FINAL clock, not an assumption that a fixed number of sandbox blocks equals seconds.

Both repay and default browser endings were executed locally with 13 independently queried FINAL native receipts, three authorization/eligibility negatives and both required viewports (see the scoped evidence in `docs/pledge/ui-lifecycle-verification.json`). No assertion or cash-delivery threshold was removed. This is a native sandbox result with explicitly mocked custody HTTP, registry and WASI host; it is not a human extension/redirect-wallet run, external USDC delivery, production custody-confinement proof or permission to enable production writes. The pushed fixture correction (740d434) passed CI web job 129659273412, including funded acceptance, on 10 November 2026 at 08:04 Africa/Cairo. This is not a remote result for the subsequent unpushed R4 sources; the fixture correction alone does not establish those distinct continuation/history/session-loss guarantees.

### PR194 R4 continuation identity and verified recovery

- A saved exit, not remembered settlement labels, controls whether recovery is rendered. Awaiting, Retryable and dispatched Pending/UNKNOWN exits keep their original controls visible without presentation history. Prepare another loan is disabled while an exit, native money intent or payout is unresolved; the handler also rechecks durable storage, and new-loan preparation refuses an existing exit. Only locally unsent states can discard or regenerate a withdrawal. Reconciliation never sends a replacement withdrawal.
- Lost-owner native recovery is deliberately resolution-only. Any tab may independently verify the original FINAL receipt against its hash, signer, receiver, every ordered action/argument/deposit/gas and dispatch-height anchor. It may then retire only the exact captured record under the same scope Web Lock, with compare-before-delete after verification. No uncertain operation is adopted or rewritten. A supplied recovery hash is verified without first attaching it to another session's record; wrong, optimistic, older or mismatched evidence cannot grant resend permission. A concurrent update or newer ID defeats the old proof's deletion. RPC verification runs outside the short mutation lock.
- The regression suite exercises actual signed NEP-413 callback parsing (both callback-URL variants), identical-fields X/Y after reload, an overwritten pending challenge, the actual disabled Prepare button in Awaiting/Retryable/Pending states, history-free recovery, and a genuinely new session after closing the origin tab. Provider/read/wallet-routing transports in the mounted component scenarios are explicit mocks; this is not a human extension-wallet or live custody proof. Native funded acceptance remains separately labelled.
- Web Locks, browser persistence and an honest configured RPC remain prerequisites. An UNKNOWN provider exit with no recoverable provider operation ID, or native uncertainty without any recoverable hash/FINAL proof, stays blocked; no timeout or session-loss guess authorizes a replacement payment. Existing lower-policy confinement, external delivery and release caveats remain in force.
- On the resource-constrained Windows PC, an unchanged dependency-import test exceeded its existing five-second default on a cold load; the complete unchanged unit suite passed on rerun. No timeout or assertion was relaxed. Heavy verification steps were run serially, with local servers stopped after use.

## PR194 R5 shared lifecycle and evidence boundaries

The account/contract lifecycle Web Lock covers synchronous opposing-record inspection and reservation for both native opening and ordinary exits, plus exact-ID mutations. No browser lock spans wallet routing/signing, RPC waits or provider work. The durable record, not elapsed time, excludes the conflicting operation. Checks inspect every token's saved exit, including malformed or legacy records, and the wallet boundary rechecks exits; resumed exits recheck native opening before worker invocation. An unexpected active loan does not conceal the saved exit panel, and withdrawal stays disabled. Nonterminal provider reconciliation leaves the exact original record UNKNOWN and names its operation ID rather than announcing reconciliation.

This is cooperative **same-origin browser** exclusion, not on-chain authority or a mutex across devices/origins. Close old-version tabs when upgrading: older clients used separate admission locks and do not acquire the new shared lock. Web Locks absence/denial and unreadable storage fail closed; there is no timeout or localStorage spin-lock fallback. Contract/worker custody admission remains the independent safety boundary. Production writes remain default OFF; none of these changes authorizes deployment, live-provider enablement or FullAccess key removal.

Funded acceptance checks exactly thirteen unique browser-wallet submissions against the independent ordered role/method plan, explicit UI terms, the exact displayed certificate, permanent-slot registration state and final-chain nonce. Full native transactions must match all ordered actions, arguments, deposits and gas, with FINAL successful execution. Only the two deliberately refused mock lower-thaw calls may have the specifically expected failed child receipt; their top-level native transaction must still succeed and subsequent retry must finish the policy. Provider admission/finish and fixture setup transactions are not included in the thirteen. The test awaits every observed wallet response, rejects missing/duplicate/extra submissions, measures inventory horizontal overflow separately, and emits counts/hashes from the current artifacts with canonical committed-source fingerprints. Raw fixture receipts and screenshots prove that isolated native run, not human-extension/redirect acceptance, external USDC settlement or live provider confinement. Historical manifests retain their own SHA and are not reused as exact-head results.

### Integrated route-specific payout coordination

Vault retains ordinary prepaid-slot onboarding and cashout, while the shared PayoutCredit surface deliberately does not mount on Vault or Pledge. Vault cashout now uses the same account/contract durable money store, expected-signer routing and FINAL action/dispatch-height verifier as Pledge; its delivery label additionally requires the existing successful-callback verifier. A final failed original transaction may retire its exact local intent only after pending payout is absent; that does not assert delivery or dispatch a replacement. Unrecoverable hashes, pending callbacks, unavailable storage/RPC and nonterminal provider results stay blocked/UNKNOWN. Ordinary registration retains explicit nonrefundable fee consent and fresh cost/status validation. Native payout coordination remains same-origin cooperative browser state, not cross-device authority or an honest-RPC substitute. A conflict-resolved source candidate requires its own CI, funded acceptance and independent integrated-head review; earlier component GO verdicts do not certify this merge or activate any production gate.
## Trust detail (moved from the README)

These are the known limits, not product features. Operator-key counts can be re-checked on [/verify](https://keyhole-seven.vercel.app/verify).

**What if TDX is broken.** An attestation proves which code ran only while the enclave is genuine. If an attacker broke Intel TDX, a forged quote could pass every check on this page. Then the attacker could read the sealed keys and act for any custody wallet. The blast radius is:

- **Confidential balances in custody wallets.** These are the funds that are not on the NEAR chain. All of them would be exposed.
- **Minting.** The minter key is sealed in the same enclave, so an attacker could mint keys.
- **The contract account is the royalty treasury.** `config.treasury` is `keyhole-devmo.near`, which is the contract account itself. Royalties from built-in sales and from royalty payouts therefore accrue to the contract account, and so do the 0.01 NEAR listing deposits of open listings until they end. The owner can change the treasury and the rate with `set_royalty`, and that change applies at buy time to open listings too, because `nft_buy` reads the current treasury and rate.

Caps and locks are enforced by the enclave, so they do not stop an attacker who runs outside it. The practical limit is to keep balances small. Custody is also run through OutLayer's custody API, so OutLayer is part of the trust base (see [Design decisions and trade-offs](#design-decisions-and-trade-offs)).

**Privacy**

- **Balances and history** live in TEE encrypted storage under the holder's key. They are readable only by a signed request from the full-access key of the account that holds the key NFT.
- **Swaps** use 1Click `confidentiality: basic | advanced`. The solvers still see the asset pair and amount of each quote. Cross-chain settlement works both ways it can end: 0.004 SOL became 0.367068 USDC at `keyhole-devmo.near`, and an order with no liquidity came back as a refund ([`docs/evidence/oneclick-sol`](docs/evidence/oneclick-sol/README.md)).
- **No KYC and no region.** Three ways in: a NEAR wallet, MetaMask, or Google or email on [/start](https://keyhole-seven.vercel.app/start), which goes through Privy.
- **The gateway keeps no record.** It does not log bodies, amounts or accounts.
- **Wallets sign messages, not transactions.** Signing costs no gas and moves no funds.
- **Public reads.** The website caches public contract reads for 60 seconds. `nft_tokens_for_owner` is not cached.

**Browser and site.** [`web/next.config.ts`](web/next.config.ts) sets a Content-Security-Policy with `frame-ancestors 'none'`, HSTS (2 years, preload), `nosniff` and strict referrer and permissions policies. `curl -I https://keyhole-seven.vercel.app` shows them.

**Agents.** Do not give an agent your main account. Mint or move a key to an account the agent controls (an implicit account is enough), set low holder caps from your wallet first (a cut is immediate, a raise waits 24 hours), and lock the key while you are away. The worker then enforces, inside the TEE: the exact signed payout destination, per-trade and per-day caps, one use per signature, the transfer cooldown, and the lock. The MCP `copy` tool needs the operator's confirmation on their own terminal. The attack log in [`docs/evidence/prompt-injection`](docs/evidence/prompt-injection/README.md) records the specific historical malformed/over-cap/replay/tamper refusals shown there; it is NOT a destination allowlist or a guarantee against a fresh valid in-cap holder-signed malicious payout.

**Function-call keys, precisely.**

- The beat key `ed25519:9FiNXX2M…` on the minter (`015a0259…c443`) is a FunctionCall key. Its receiver is `keyhole-devmo.near`, its only method is `beat`, and its remaining allowance was 0.0498 NEAR on 2026-11-07 (read over RPC `view_access_key_list`).
- It cannot transfer NEAR, attach a deposit, add or delete keys, or call any method except `beat`. A different method is refused with `MethodNameMismatch`. Its allowance is the only NEAR it can spend, as gas, and the owner revokes it with `del_beat_key`.
- It is not the payment key. The worker refuses function-call keys for holder requests (`key_not_owned`), so `withdraw`, `quote --execute` and `copy` still need a holder's full-access key.

**Operator keys on the contract account.** `keyhole-devmo.near` holds two full-access keys and one function-call key (RPC, 2026-11-09). The table lists each key and its stated purpose. The contract has no multisig and is not locked.

| Account | Key | Permission | Stated purpose |
|---|---|---|---|
| `keyhole-devmo.near` (contract) | `ed25519:7N1fLo9M…` | FullAccess | Deploy and publish key. The earlier revision of this README says it is kept offline and never on the website or in the worker |
| `keyhole-devmo.near` | `ed25519:8NP9x5eF…` | **FullAccess** | The owner's second wallet key: Meteor Wallet holds it for this account (it is the key Meteor lists for `keyhole-devmo.near` at sign-in). Same owner as the key above; an operator key, listed under [Design decisions and trade-offs](#design-decisions-and-trade-offs) |
| `keyhole-devmo.near` | `ed25519:FNe2aYtz…` | **FunctionCall** to `social`, methods `__fastdata_kv` and `__fastdata_fastfs`, 1 NEAR allowance | Uploads the worker wasm to FastFS. It cannot transfer NEAR, call the contract or add keys |
| minter `015a0259…c443` (implicit) | `ed25519:6H1iG1oH…` | FullAccess | Generated and held inside the TEE (OutLayer secret). The minter signs mints, PnL statements and log heads. The contract only lets this account mint |
| minter `015a0259…c443` | `ed25519:9FiNXX2M…` (beat key) | **FunctionCall** to `keyhole-devmo.near`, method `beat` only, 0.05 NEAR allowance | Lets an off-enclave agent emit the per-key heartbeat. Added by the enclave on the owner's signed `add_beat_key` ([AddKey tx](https://nearblocks.io/txns/DXH756vmgj8GTDz6fUwnfgaUuC7vCi1vu6VaX5heoDww)). Remaining allowance 0.0498 NEAR on 2026-11-07 |

The first full-access key is described in the repository as the deploy and publish key, kept offline and never on the website or in the worker.


## Guarded worker source-candidate integration details

Mainnet remains v2.4, worker d337e822. No deployment/publication/version retirement/funding/credential or access-key change is performed or authorized by source changes. Production requires independent exact-head review, live custody confinement proof and separate rollout approval. Unknown native-outcome liveness and operational longevity must be resolved before considering FullAccess removal. Web changes must preserve the existing dashboard and wait for reviewed green contract+worker PRs.

### Guarded worker candidate — SOURCE ONLY, NOT PUBLISHED

Integrated with reviewed prepaid-slot #184 head92da286 and #193 delivery-clock/custody serialization; source only, not a production rollout. Every custody swap/copy/withdraw/private transfer/wet quote uses the shared production admission/provider drivers. Persisted journals bind exact owner/epoch/nonce/body/action; an op ID/idempotency key never changes on retry. Value requests require signed decimal-string `params.owner_epoch`; legacy sessions are rejected and A→B→A cannot revive old authorizations. Provisional receivers cannot read sealed data or establish sessions; pledged legitimate holders may still read.

The fresh fixed-floor certificate uses V3_DELIVERY and verifies exact binding plus the contract-confirmed local command sequence; current policy/loan/control are re-read after the private balance/inventory observation. Canonical project UUID and a single pinned nonlegacy version are required. A sealed authority-audit record must already exist; no public/automatic eligibility writer or silent legacy-wallet approval exists. This remains a fail-closed rollout gate, not self-measured code proof.

Generic detached `chain_sign` is disabled in this source revision, including protected/pledged collateral, and the owner/epoch settle gate is explicit. Prior foreign signatures cannot be revoked, so foreign assets/allowances are excluded from the fixed custody-USDC certificate. This is not a claim to have changed live versions or existing credentials.

**Candidate destination policy: self-exit only.** Fresh NEP-413 authorization derives the authenticated NEAR holder; EIP-191 derives the same authenticated0x holder on supported EVM chains. Unknown identity/chain mapping and any different `to` are rejected, including private-transfer bypasses and durable POST replay. Sessions cannot withdraw. Current LIVE source historically allows arbitrary well-formed holder-signed destinations: this source-only restriction has not been deployed, and old attack examples do not prove it live.

The two named cross-layer tests use REAL NEAR admission/pledge/title receipts and the same production drivers as WASI, but HTTP, sealed storage, registry and eligibility observations are labelled mocks. They cover repay/default, failures/unknowns, transfer_call A→B→A and legitimate post-thaw exits, not live-provider confinement or a full WASI-host execution. Source-only native payment UNKNOWN/liveness and live confinement gates remain. No deploy/publish/funding/legacy-version retirement/key or policy change is performed.

### Clean-install dependency advisory boundary

The PR201 R4 repair updates the six reviewed high wallet-leaf families: legacy bs58/base-x, lodash, nanoid, decode-uri-component, zod and ws. Exact upgrades, consumer migrations, compatibility tests and clean-install proof are in [wallet-dependencies-r4.md](docs/evidence/integration-stack/wallet-dependencies-r4.md). The old noble hash overrides were unnecessary and inherited differently by npm 10/11; removing them preserves each upstream declared hash major/pin rather than forcing v2 onto v1 consumers. CI now pins the supported Node 22.22.2 / npm 10.8.2 pair.

Production-graph `npm audit --omit=dev --json` before: **63 package-level entries (22 low / 13 moderate / 28 high / 0 critical)**. After: **45 (34 low / 11 moderate / 0 high / 0 critical)**. Full audit after: **53 (34 low / 19 moderate / 0 high / 0 critical)**, including eight dev-only moderate lint-analysis entries. Raw before/after production graphs are linked from the compatibility proof. Counts include propagation through parent libraries; the low count changes with deduplication/severity reclassification and is not 34 independently demonstrated exploits. No force/legacy-peer-deps or automatic audit downgrade was used.

Remaining runtime-graph roots include elliptic/secp256k1, bn.js, uuid and MetaMask SDK's historical debug advisory. The resolved debug remains 4.4.3, not the compromised 4.4.2. Browser wallet ws 8.x resolves to native WebSocket/stubs rather than its Node framing path; the retained 7.x caller is patched 7.5.13. Installed-leaf audit cannot certify code embedded in upstream bundles (including the unused x402 paywall), live extension/redirect-wallet behavior, third-party origin policy, Rust dependencies or live custody confinement. Zod migration is reviewed for the installed consumers, not a claim that arbitrary v3 users can be overridden safely: version/source-count drift in the consumer patch script rejects installation, and explicit schema/ABI/popup/codec regressions gate the locked graph. Passing tests and zero high audit entries are not a vulnerability-free or production-activation certificate.

## Counterparty-check boundary

Limits of this check: it is advisory. Anyone with the full-access key can sign without it. A new address with history can still be a scam, so ALLOW is not safety. Nearblocks returned HTTP 429 after a short burst of test checks, and a 429 is a WARN. Comparing code hashes proves that code differs between two points in time; it does not count deploys. Proof: [`cli/test/guard.test.ts`](cli/test/guard.test.ts), [`cli/test/counterparty.test.ts`](cli/test/counterparty.test.ts) and [`web/tests/check.test.ts`](web/tests/check.test.ts).
