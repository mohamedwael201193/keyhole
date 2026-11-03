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
| **E**levation of privilege | A function-call key or agent drains funds | full-access key required; per-trade and daily caps; raises wait 24 h; withdraw only to the signer | `over_cap_per_tx_refused`, `holder_cut_applies_now_and_raise_waits_a_day`, `withdraw_refuses_any_destination_but_the_signer` |
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
| A payout in flight when the key moves never settles for the old holder twice or for the new holder wrongly | `invariant_transfer_mid_payout_never_settles_for_the_old_holder`, `random_transfer_and_withdraw_never_pays_the_previous_holder`; mainnet run in `docs/evidence/mid-payout` |
| NEP-199 payout always adds up to the sale balance | contract `nep199_payout_conserves_balance` |
| A holder's best tier follows the token on transfer | contract `holder_tier_is_best_and_follows_transfer` |

## Audit checklist

- [x] Contract: init private, mint minter-only, setters owner-only with 1 yocto, royalty ≤ 10 %, token id 1–64 bytes, beat batch ≤ 50, one key per account on mint and every transfer path, `migrate` self-only and once.
- [x] Contract: standard NEP-171 transfer rules (owner or approved, 1 yocto, no self-transfer) and events; NEP-178 approvals cleared on every transfer.
- [x] Worker: every state-changing op authenticates, checks freshness and nonce, reads the owner on chain.
- [x] Worker: amounts parsed as integers; USD caps checked before any external call; spend rolled back on failure.
- [x] Worker: withdraw destination must be the signer; cooldown after transfer.
- [x] Secrets: none in the repo (CI `hygiene` job scans); site keys are server-only Vercel env vars.
- [x] Reproducible build: pinned toolchain, path remapping, hash checked in CI against FastFS.
- [x] Attestation: report_data recomputed from the attested fields; DCAP chain to the pinned Intel root.
- [x] Intel collateral checked in the browser: PCK and Root CA CRLs, TCB Info, TDX module and QE identity, signatures to the pinned Intel root ([`web/lib/pcs.ts`](web/lib/pcs.ts)).
- [ ] No third-party audit yet.

## Scope notes, and why they fit the design

- **The enclave is the custodian, by design.** The OutLayer operator runs the service, but balances and trades are sealed by Intel TDX, so the operator cannot read them. That is the privacy promise: the chain shows who holds the key, never what the account holds. Every reply carries a quote you can check in the browser on `/verify`.
- **The key moves by plain transfer.** The contract has no NEP-178 approvals yet, so approval-based marketplaces cannot list a key. Transfers and `nft_transfer_payout` work, and ownership is re-read before every swap or withdraw, so the account always follows the NFT, even mid-payout ([evidence](docs/evidence/mid-payout/README.md)).
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
- The 30-step mainnet log in the README (§10) was recorded against worker `f13efe92`. The worker serving the site is `a55ebb14` ([add_version tx](https://nearblocks.io/txns/GNqXiicFgXQpS5LsYiNRffK6Xhp5W7Yi8EZK2XqKvX8X)), which includes the review fixes R1 to R4.
- Prices come from the NEAR Intents token list. An asset with no price is named as unpriced. USDC is treated as $1 only when that list has no price for it.

## Chain Signatures (`chain_sign`)

`chain_sign` asks `v1.signer` for a signature from the key's derived secp256k1 address (`keyhole/key/<token_id>`). The worker does not parse the 32-byte payload, so it cannot price it in USD and the tier caps do not apply. The guards that do apply, in the enclave (live since build `a55ebb14`; a locked key's `chain_sign` refused on mainnet, see `docs/evidence/publish-a55ebb14`): the holder must sign the request (full-access key or EIP-191), the key must not be locked for sale, the post-transfer cooldown must have passed, and each key can request at most 5 signatures per UTC day (each one costs the minter gas). The public gateway does not expose the op. The derived addresses hold no funds; treat any balance sent there as outside KEYHOLE's spend caps.

## One key per account

The contract refuses a mint or a transfer (`nft_transfer`, `nft_transfer_call`, `nft_transfer_payout`) to an account that already holds a key. While a key is out on `nft_transfer_call`, its sender also counts as a holder until `nft_resolve_transfer` runs (`pending_return_count`), so a key the receiver sends back never lands next to a second one. The sandbox test `transfer_call_race_is_closed_on_v2_2` drives that exact interleaving with a receiver contract that tries to hand the sender a second key inside `nft_on_transfer`. Caps follow `holder_tier`, and the worker refuses any signed request that does not name `params.token_id`.

## Royalty

`config.royalty_bps` is 500. `nft_payout` and `nft_transfer_payout` return a 5% split to the treasury; the marketplace that called `nft_transfer_payout` pays it. A plain `nft_transfer` or `nft_transfer_call` carries no price, so it pays no royalty (as in every NEP-199 contract); a marketplace that ignores NEP-199 is not forced to pay.

## Contract upgrades

`keyhole-devmo.near` holds a full-access key, so its owner can deploy new code. v1 to v2 added `migrate()`; v2.1 and v2.2 changed code only. Every deployed version is in `contracts/keys/release` with its sha256, CI rebuilds the source to the newest one, and `judge/1-contract.sh` compares the on-chain `code_hash` with `contracts/keys/deployed`.

## Sessions (one signature, then no wallet popups for 30 minutes)

**Connect and unlock in one popup.** NEAR wallets connect through `@hot-labs/near-connect`, the connector the NEAR docs use for wallet login (https://docs.near.org/web3-apps/tutorials/wallet-login). Its `connect({ signMessageParams })` signs in and signs one NEP-413 message in the same wallet prompt (https://github.com/hot-dao/near-selector, README "Initialize connection to wallet and sign in"). That message is the `session` request. Because it is built before the account is known, a `session` request (and only that op) may leave `account_id` empty; the enclave then uses the NEP-413 signer and still requires that the public key is a full-access key of that account, exactly as the backend-auth doc describes. The session binds to the first key that account holds. MetaMask is not offered by near-connect with message signing, so EVM accounts keep the EIP-191 path: connect, then one `personal_sign` to unlock.

This follows NEAR's documented backend-auth pattern (https://docs.near.org/web3-apps/backend/backend#backend-auth-with-a-near-wallet): the user signs one NEP-413 message with a nonce and recipient, the backend checks the signature and that the key is a full-access key of the account, and then issues a session. Here the backend is the enclave.

- **Start:** the wallet signs `{op:"session", params:{max_usd_micro, ttl_ms?, scope?}}` (NEP-413; EIP-191 for MetaMask). The enclave runs the same checks as every other signed op (signature, full-access key, freshness, single-use nonce, current holder), then returns a random 32-byte `session_token`. Only `sha256(token)` is stored, together with the grant `{account, token_id, exp_ms, max_usd_micro, scope}`.
- **Use:** each request carries `{token, message:{op, account_id, ts_ms, params}, nonce}`. The enclave checks (`authenticate_session` in `tee/worker/src/main.rs`; pure checks in `lib.rs`; 40 tests in `src/session.rs`):
  - the grant exists, is not revoked and has not expired (30 minutes at most);
  - the op is in scope: `status, quote, account, balance, swap, copy, withdraw, history, pnl, limits (lowering only), dashboard, session_revoke`;
  - the account and token in the request match the grant;
  - freshness (±5 min) and a single-use nonce;
  - the account **still holds the key**, read live on every call, so a sale ends the session;
  - the grant's spend cap, on top of the unchanged tier and holder caps.
- **End:** the Revoke button (and sign-out) sends `session_revoke`.

Caveats:
- The token is a bearer credential, like any Web2 session. Anyone who has it can act within its scope until it expires, is revoked, or its cap is used up. That includes script injection on the site, and the site's gateway, which relays the request body (bodies are not logged). The token cannot raise limits (a raise needs a wallet signature and still waits 24 h), lock, prove, mint or use chain_sign.
- Withdraw is in scope, but it pays out only to the holder's own account (`assert_withdraw_to`), so a token thief cannot redirect funds.

## Worker hardening in source (live after the next publish)

- Replay check runs before the rate limits (`admit`), so replays cost no rate budget.
- `chain_sign` counts toward the daily quota only after a signature that recovers to the key; a failed MPC call costs nothing.
- `withdraw` re-reads key ownership after the custody move and reports `needs_review` if the key changed hands meanwhile.
- `quote` refuses a key locked for sale, and pins `recipient` and `refund_to` to the signer.
- `add_beat_key` / `del_beat_key` check the signer against the keys contract `config().owner`, read live.

Tests: `tee/worker/src/p2harden.rs`.
