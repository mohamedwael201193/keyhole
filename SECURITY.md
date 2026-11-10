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
| **E**levation of privilege | A function-call key or agent drains funds | full-access key required; per-trade and daily caps; raises wait 24 h; withdraw to a destination the holder signs, shape-checked per chain | `over_cap_per_tx_refused`, `holder_cut_applies_now_and_raise_waits_a_day`, `withdraw_destination_must_be_a_valid_address_for_its_chain` |
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
- [x] Worker: withdraw destination is a well-formed address for its chain, covered by the holder's signature; caps, cooldown after transfer and listing freeze still apply.
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
- The 30-step mainnet log in the README (§9) was recorded against worker `f13efe92`. The worker serving the site is `d337e822` ([add_version tx](https://nearblocks.io/txns/BWQxEoSg3b6XHdk4iooAneoBJM7EtP83HTrvYXpdBQi5)); before it `cc8d2fa8` ([add_version tx](https://nearblocks.io/txns/Epaz3aMAk1WuLGaMuHKCACvGU981uEr4zUqzyep1zfi6)), `a985fd87` ([add_version tx](https://nearblocks.io/txns/A1o8882hpjZmBr56hhDop236MrSFtEnMfNt9nEZwo4sG)), `ebeb6a34` (published and rolled back, [add_version tx](https://nearblocks.io/txns/MG7pGVSNjFDz85yqrAA9stN4yyXECYfYLDmCgYE4gyq)), `94c355ff` ([add_version tx](https://nearblocks.io/txns/EA7S1TeVnMF1v5FthV4ffQf9NYXfGJTtzo4ZRp25ZBjy)), `cff9fd3c`, then `a55ebb14`, which includes the review fixes R1 to R4.
- Prices come from the NEAR Intents token list. An asset with no price is named as unpriced. USDC is treated as $1 only when that list has no price for it.

## Chain Signatures (`chain_sign`)

`chain_sign` asks `v1.signer` for a signature from the key's derived secp256k1 address (`keyhole/key/<token_id>`). The worker does not parse the 32-byte payload, so it cannot price it in USD and the tier caps do not apply. The guards that do apply, in the enclave (live since build `a55ebb14`; a locked key's `chain_sign` refused on mainnet, see `docs/evidence/publish-a55ebb14`): the holder must sign the request (full-access key or EIP-191), the key must not be locked for sale, the post-transfer cooldown must have passed, and each key can request at most 5 signatures per UTC day (each one costs the minter gas). The public gateway does not expose the op. The derived addresses hold no funds; treat any balance sent there as outside KEYHOLE's spend caps.

## One key per account

The contract refuses a mint or a transfer (`nft_transfer`, `nft_transfer_call`, `nft_transfer_payout`) to an account that already holds a key. While a key is out on `nft_transfer_call`, its sender also counts as a holder until `nft_resolve_transfer` runs (`pending_return_count`), so a key the receiver sends back never lands next to a second one. The sandbox test `transfer_call_race_is_closed_on_v2_2` drives that exact interleaving with a receiver contract that tries to hand the sender a second key inside `nft_on_transfer`. Caps follow `holder_tier`, and the worker refuses any signed request that does not name `params.token_id`.

## Royalty

`config.royalty_bps` is 500. `nft_payout` and `nft_transfer_payout` return a 5% split to the treasury; the marketplace that called `nft_transfer_payout` pays it. A plain `nft_transfer` or `nft_transfer_call` carries no price, so it pays no royalty (as in every NEP-199 contract); a marketplace that ignores NEP-199 is not forced to pay.

## Contract upgrades

`keyhole-devmo.near` holds a full-access key, so its owner can deploy new code. v1 to v2 added `migrate()`; v2.1, v2.2 and v2.3 changed code only. v2.3 (live since 2026-11-07) caps approvals at 10 per token; its evidence is in [`docs/evidence/contract-v2-3`](docs/evidence/contract-v2-3/README.md). Every deployed version is in `contracts/keys/release` with its sha256, CI rebuilds the source to the newest one, and `judge/1-contract.sh` compares the on-chain `code_hash` with `contracts/keys/deployed`.

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
- The previous build 94c355ff accepted `withdraw` with a session token. It pays out only to the holder's own account (`assert_withdraw_to`), so a token thief cannot redirect funds, but could still move the funds in that account.
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

- If the OutLayer payment balance runs out, live calls stop and `/api/health` (the strip on /judge) shows "offline: payment balance empty". Attestations, FastFS wasm and on-chain state stay public and verifiable.

## Design decisions and trade-offs

Each entry gives the decision, the reason for it, and the mitigation. Each one is a limit that remains in the design. Nothing here is hidden elsewhere in the repository.

### 1. Settlement epoch voids a mid-flight settle that has not left custody

- **Decision.** Every value-moving op is stamped with the key's settlement epoch. When the enclave first sees a new owner (transfer or sale), it bumps that epoch. A settle whose stamp no longer matches is refused `epoch_void` (or reported `needs_review` if the custody call already returned). Funds that have not left custody stay with the key.
- **Why.** Track 10 asks for a sale in the middle of a payout. Ownership alone is re-read before the send; the epoch closes the same race for any concurrent settle stamped earlier (see [THREAT_MODEL.md](THREAT_MODEL.md)).
- **Mitigation.** Owner check + epoch check run immediately before the send; listing is re-read then too. After the custody call, ownership or epoch drift becomes `needs_review` instead of a plain success. The historical mid-payout run on build `6367401a` (2026-11-01) in [docs/evidence/mid-payout](docs/evidence/mid-payout/README.md) predates the epoch; a re-run on the epoch build is required before claiming the invariant on mainnet. A custody payout that OutLayer has already completed cannot be recalled on chain.

### 2. No NEAR sub-account per key

- **Decision.** Each `token_id` has one OutLayer confidential custody wallet, held inside the TEE. There is no NEAR sub-account.
- **Why.** A NEAR sub-account would need an access key, and someone would hold that key. Here the keys never leave the enclave.
- **Mitigation.** The holder cannot take the key out, and the account is not a NEAR account that a wallet can open directly. OutLayer runs the custody service, so it is a third-party custody API and part of the trust base. Keep balances small: the caps and locks are enforced inside the enclave, but they do not stop an attacker who runs outside it (see [README §8](README.md#8-security-model)).

### 3. The contract account is not locked

- **Decision.** `keyhole-devmo.near` holds two full-access keys, and its owner can change the contract. There is no multisig and no timelock, and the account is not keyless.
- **Why.** Each contract version so far is a code deploy signed by a full-access key (v1 to v2.4). The multisig and timelock are not built yet.
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
- **Why.** A wet quote with an INTENTS deposit can move custody funds the same way a swap does.
- **Mitigation.** The check-then-act window is one custody round-trip. A listing that appears after the second read is seen by the next request; an epoch bump from a sale voids the settle stamp.

### 10. Transfer events declare NEP-171 1.0.0

- **Decision.** The custom transfer helper emits the `nft_transfer` event through the standards crate's `NftTransfer` struct, which declares version 1.0.0. The `nft_metadata_update` event declares 1.2.0.
- **Why.** The event struct comes from `near-contract-standards`, and it declares 1.0.0.
- **Mitigation.** The transfer event is to be aligned to 1.2.0 in the next contract release.

### 11. Operator keys

- **Decision.** `keyhole-devmo.near` has two full-access keys (deploy key and the owner's Meteor wallet key) plus a function-call beat key that can call only `beat`. The minter account's full-access key is generated and kept inside the TEE. There is no timelock or multisig yet. Live count is re-checked on [/verify](https://keyhole-seven.vercel.app/verify).
- **Why.** The reasons are those in entry 3. The key list and the stated purpose of each key are in [README §8](README.md#8-security-model).
- **Mitigation.** The beat key is a function-call key that can call only `beat`, with a 0.05 NEAR allowance, and the owner revokes it with `del_beat_key`. The deploy key is described in the repository as kept offline and never on the website or in the worker.


## Two-sided Pledge UI release gate

This source is not complete first-class funded-loan acceptance. Public certificate transport and canonical signature/binding verification are implemented; the displayed certification expires conservatively. Native-credit wallet dispatch has persisted-before-wallet state, exact final-receipt binding and an anti-replay dispatch-block anchor. A lost hash/unknown callback remains blocked, not automatically retried or refunded. Storage corruption or a missing final dispatch anchor stops wallet dispatch. These tests are not a browser-wallet or live provider proof.

`NEXT_PUBLIC_PLEDGE_TRANSACTIONS` is a separate default-OFF write gate. New-loan open/fund/repay controls remain disabled: a private complete borrower at-risk inventory, full certificate-bound lifecycle wallet flow and both sandbox browser endings remain acceptance gates. UI/API transport must be independently reviewed with the final worker and contract. The V3 contract candidate starts debt only at the exact genuine successful native principal cashout callback; failed/UNKNOWN delivery accrues no debt. The UI must not infer delivery from funding or a transaction hash. Older deployed candidates do not implement this ABI.

A verified Ed25519 floor is a pinned trusted-attestor statement, not proof of measured worker execution, attestation-chain enrollment, absence of retained authority, live provider confinement or full-account value. Verify the exact signed output's runtime/signer provenance independently before lending. The source Boolean serializer is enforced by the contract/worker API; retained FullAccess keys can directly act as the controller or replace code and bypass it until removal. Keys remain retained under the approved plan; no key action is authorized here.

The economics model is verified with injected test quotes, not live confidential forward/reverse quotes. Current quote integration is absent, so the actual page shows Comparison unavailable at this size. A foreign/public-ledger quote is not a confidential-ledger quote. Fixed costs, lock/default/provider/availability risks and future income are not zero or guaranteed. Public floor is not NAV, LTV or maximum loss. Team-operated examples are not organic demand or net-profit evidence. The lender component uses public projection only; full authenticated network/cache/log privacy inspection remains an integration acceptance gate.

### Permanent payout storage in the first action (candidate #184 `92da286`)

The client reads final `payout_account_registered` and exact `payout_storage_cost`. A missing slot adds registration (20 Tgas) before the intended loan action (200 Tgas), one atomic same-receiver transaction/one wallet confirmation, never a silent sequential fallback. Fee consent is one explicit line: the charge is permanent, nonrefundable and reusable, separately shown from principal, repayment, the refundable loan bond and gas. Unknown status/cost fails closed. The current tested charge is 0.0032 NEAR per account; at 0.01 principal and 0.009 bond, a first-ever borrower has -0.0022 NEAR incremental liquidity before other costs. The comparison explicitly includes this charge once or remains unavailable when its quote is unknown.

A sponsor can create the slot between preflight and wallet submission. The unconditional registration/action batch then fails atomically, not half-successfully. Retain its exact failed transaction hash and persisted ordered action list, verify the original FINAL receipt and refresh registration. Registered=true means onboarding is already satisfied: a **new manual** intent skips registration and pays no second slot fee. Never silently replay a paid batch or infer failure from elapsed time. Tests cover both wallet-adapter action shapes, ordered batch receipt binding, failed-hash retention and fresh registered-state preparation. Separate normal-WASM contract tests cover register+open/register+fund at 220 Tgas, atomic rollback and sponsored action-only retries. They are not a human wallet/browser proof; the complete funded lifecycle release gates above remain.
