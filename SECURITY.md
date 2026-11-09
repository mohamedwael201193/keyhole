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

- Intel TDX and the OutLayer runtime run the published wasm. Anyone can check this per call: `/verify` re-runs 19 Intel DCAP checks and the report_data binding in the browser, and the quick path separately hashes the published Wasm bytes. Source-build verification scope is recorded below.
- NEAR RPC returns the true owner of a token. The worker reads `nft_token` on every signed request.
- Holder authorization is checked by the worker rather than accepted from the website or an agent. The gateway relays plaintext requests/replies and session credentials; browser-delivered verifier code and its pinned expectations also require trust unless independently pinned and executed. Intel/OutLayer runtime and custody governance, public RPC, publisher/contract authority and service availability are distinct trust roots.

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

- **The enclave is the custodian, by design.** The privacy boundary includes the Intel TDX worker, sealed application credentials, OutLayer custody/keystore infrastructure and its governance. Public ownership, funding traces and solver-visible trade data are outside that private ledger; do not interpret the private balance UI as universal transaction anonymity. Every reply carries a quote you can check in the browser on `/verify`.
- **The key moves by plain transfer.** Contract v2.4 supports NEP-178 approvals (cleared on transfer) and built-in listing/buying. Transfers and `nft_transfer_payout` work, and ownership is re-read before every swap or withdraw, so the account always follows the NFT, even mid-payout ([evidence](docs/evidence/mid-payout/README.md)).
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

`chain_sign` asks `v1.signer` for a signature from the key's derived secp256k1 address (`keyhole/key/<token_id>`). The worker does not parse the 32-byte payload, so it cannot price it in USD and the tier caps do not apply. The guards that do apply, in the enclave (live since build `a55ebb14`; a locked key's `chain_sign` refused on mainnet, see `docs/evidence/publish-a55ebb14`): the holder must sign the request (full-access key or EIP-191), the key must not be locked for sale, the post-transfer cooldown must have passed, and each key can request at most 5 signatures per UTC day (each one costs the minter gas). The public gateway does not expose the op. Balances sent to those derived addresses are outside KEYHOLE's ordinary custody spend caps.

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

- **Decision.** Each `token_id` has one OutLayer confidential custody wallet, held inside the TEE. There is no NEAR sub-account per token in this implementation.
- **Why.** This implementation uses OutLayer confidential custody and a private ledger. NEAR contracts can be keyless; a private key is not a requirement of a NEAR sub-account. Keyless on-chain accounts are a different valid architecture.
- **Mitigation.** The holder cannot take the key out, and the account is not a NEAR account that a wallet can open directly. OutLayer runs the custody service, so it is a third-party custody API and part of the trust base. Keep balances small: the caps and locks are enforced inside the enclave, but they do not stop an attacker who runs outside it (see [public authority inventory](#public-authority-inventory-and-browser-boundary)).

### 3. The contract account is not locked

- **Decision.** `keyhole-devmo.near` holds two full-access keys, and its owner can change the contract. There is no multisig and no timelock, and the account is not keyless.
- **Why.** Each contract version so far is a code deploy signed by a full-access key (v1 to v2.4). The multisig and timelock are not built yet.
- **Mitigation.** Every deployed version is in `contracts/keys/release` with its sha256. CI rebuilds the source, and `judge/1-contract.sh` compares the on-chain `code_hash` with the committed wasm. The key list and the purpose of each key are in [public authority inventory](#public-authority-inventory-and-browser-boundary).

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
- **Why.** The reasons are those in entry 3. The key list and the stated purpose of each key are in [public authority inventory](#public-authority-inventory-and-browser-boundary).
- **Mitigation.** The beat key is a function-call key that can call only `beat`, with a 0.05 NEAR allowance, and the owner revokes it with `del_beat_key`. The deploy key is described in the repository as kept offline and never on the website or in the worker.


## Public authority inventory and browser boundary

**What if TDX is broken.** An attestation proves which code ran only while the enclave is genuine. If an attacker broke Intel TDX, a forged quote could pass every check on this page. Then the attacker could read the sealed keys and act for any custody wallet. The blast radius is:

- **Confidential balances in custody wallets.** These are the funds that are not on the NEAR chain. All of them would be exposed.
- **Minting.** The minter key is sealed in the same enclave, so an attacker could mint keys.
- **The contract account is the royalty treasury.** `config.treasury` is `keyhole-devmo.near`, which is the contract account itself. Royalties from built-in sales and from royalty payouts therefore accrue to the contract account, and so do the 0.01 NEAR listing deposits of open listings until they end. The owner can change the treasury and the rate with `set_royalty`, and that change applies at buy time to open listings too, because `nft_buy` reads the current treasury and rate.

Caps and locks are enforced by the enclave, so they do not stop an attacker who runs outside it. The practical limit is to keep balances small. Custody is also run through OutLayer's custody API, so OutLayer is part of the trust base (see [SECURITY.md](SECURITY.md#design-decisions-and-trade-offs)).

**Privacy**

- **Balances and history** live in TEE encrypted storage under the holder's key. They are readable only by a signed request from the full-access key of the account that holds the key NFT.
- **Swaps** use 1Click `confidentiality: basic | advanced`. The solvers still see the asset pair and amount of each quote. Cross-chain settlement works both ways it can end: 0.004 SOL became 0.367068 USDC at `keyhole-devmo.near`, and an order with no liquidity came back as a refund ([`docs/evidence/oneclick-sol`](docs/evidence/oneclick-sol/README.md)).
- **No KYC and no region.** Three ways in: a NEAR wallet, MetaMask, or Google or email on [/start](https://keyhole-seven.vercel.app/start), which goes through Privy.
- **The gateway keeps no record.** It does not log bodies, amounts or accounts.
- **Read/login signatures and value intents are different.** A read/login signature does not transfer assets. A signed swap or withdrawal intent authorizes the worker to move the displayed value, potentially to any supported destination covered by that signature; inspect asset, amount, network, destination, minimum output, expiry and fees first.
- **Public reads.** The website caches public contract reads for 60 seconds. `nft_tokens_for_owner` is not cached.

**Browser and site.** [`web/next.config.ts`](web/next.config.ts) sets a Content-Security-Policy with `frame-ancestors 'none'`, HSTS (2 years, preload), `nosniff` and strict referrer and permissions policies. `curl -I https://keyhole-seven.vercel.app` shows them.

**Agents.** Do not give an agent your main account. Mint or move a key to an account the agent controls (an implicit account is enough), set low holder caps from your wallet first (a cut is immediate, a raise waits 24 hours), and lock the key while you are away. The worker then enforces, inside the TEE: holder authentication of the signed operation and destination, per-trade and per-day custody caps, one use per signature, the transfer cooldown, and the lock. A holder can sign a supported destination other than their own wallet. The MCP `copy` tool needs the operator's confirmation on their own terminal. The historical attack log in [`docs/evidence/prompt-injection`](docs/evidence/prompt-injection/README.md) records specific refused inputs/builds. It is not a current destination firewall or a universal prompt-injection defense; a freshly signed, in-cap, well-formed malicious destination is not rejected merely for being malicious.

**Function-call keys, precisely.**

- The beat key `ed25519:9FiNXX2M…` on the minter (`015a0259…c443`) is a FunctionCall key. Its receiver is `keyhole-devmo.near`, its only method is `beat`, and its remaining allowance was 0.0498 NEAR on 2026-11-07 (read over RPC `view_access_key_list`).
- It cannot transfer NEAR, attach a deposit, add or delete keys, or call any method except `beat`. A different method is refused with `MethodNameMismatch`. Its allowance is the only NEAR it can spend, as gas, and the owner revokes it with `del_beat_key`.
- It is not the payment key. The worker refuses function-call keys for holder requests (`key_not_owned`), so `withdraw`, `quote --execute` and `copy` still need a holder's full-access key.

**Operator keys on the contract account.** `keyhole-devmo.near` holds two full-access keys and one function-call key (RPC, 2026-11-09). The table lists each key and its stated purpose. The contract has no multisig and is not locked.

| Account | Key | Permission | Stated purpose |
|---|---|---|---|
| `keyhole-devmo.near` (contract) | `ed25519:7N1fLo9M…` | FullAccess | Deploy and publish key. The earlier revision of this README says it is kept offline and never on the website or in the worker |
| `keyhole-devmo.near` | `ed25519:8NP9x5eF…` | **FullAccess** | The owner's second wallet key: Meteor Wallet holds it for this account (it is the key Meteor lists for `keyhole-devmo.near` at sign-in). Same owner as the key above; an operator key, listed in [SECURITY.md](SECURITY.md#design-decisions-and-trade-offs) |
| `keyhole-devmo.near` | `ed25519:FNe2aYtz…` | **FunctionCall** to `social`, methods `__fastdata_kv` and `__fastdata_fastfs`, 1 NEAR allowance | Uploads the worker wasm to FastFS. It cannot transfer NEAR, call the contract or add keys |
| minter `015a0259…c443` (implicit) | `ed25519:6H1iG1oH…` | FullAccess | Generated and held inside the TEE (OutLayer secret). The minter signs mints, swap-log statements and log heads. The contract only lets this account mint |
| minter `015a0259…c443` | `ed25519:9FiNXX2M…` (beat key) | **FunctionCall** to `keyhole-devmo.near`, method `beat` only, 0.05 NEAR allowance | Lets an off-enclave agent emit the per-key heartbeat. Added by the enclave on the owner's signed `add_beat_key` ([AddKey tx](https://nearblocks.io/txns/DXH756vmgj8GTDz6fUwnfgaUuC7vCi1vu6VaX5heoDww)). Remaining allowance 0.0498 NEAR on 2026-11-07 |

The first full-access key is described in the repository as the deploy and publish key, kept offline and never on the website or in the worker.


## Source-build verification scope

The README quick path proves artifact identity (committed contract Wasm versus mainnet `code_hash`, and published worker bytes versus the attested hash). It does not equate the current main branch with a fresh byte-identical rebuild of the live worker.

On 10 November 2026 (Africa/Cairo), a clean Linux run of the current `tee/worker/build.sh` produced `49f9e0a13f4deba449a4295ecb2232f8bda7813bb65835597a462b0edebef531`, not live `d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41`. The packaged source archive produced that same Linux hash. Current source includes the settlement-epoch change after the last worker publication. A separate Linux build of publication commit `0b2df07d70140c6305b7df3907460ad0dbf21dce` produced `64816c13d811b3e20553214f69d372f1170355b1e391bf89dd3fa209e2a306fc`. Published Wasm strings contain Windows-style dependency/source separators, while the Linux output contains Linux-style separators. That observation is not proof that path separators are the only difference.

Consequently the failed source-rebuild command is not offered as a guaranteed README acceptance command. A byte-identical source rebuild of the live worker remains unproven on this Linux environment. No deployment, source substitution or binary patching was performed to manufacture a match. The raw rebuild outputs are in [the README verification evidence](docs/evidence/readme-verification/).


## Public event commitments and financial interpretation

Legacy public provenance uses deterministic SHA256 commitments to event detail. A signature authenticates chain integrity, not information-theoretic secrecy: predictable low-entropy detail may permit inference from a public commitment. Public metadata, voluntarily published outputs and previous holders' knowledge cannot be erased by a new UI label. Private-endpoint authorization and hiding of public log commitments are separate properties. No secret-blinded replacement is described as deployed by this README change.

Signed swap counts, gross volume, input costs and event heads are not complete PnL, net asset valuation, future returns, seller skill or evidence of independent demand. The public log verifier establishes integrity of the returned chain, not completeness of all provider-side financial activity. Historical team-wallet sales demonstrate mechanics, not an organic market or a wrapper premium. Ordinary tier/day caps, cooldown, royalties and provider fees also affect actual redemption.
