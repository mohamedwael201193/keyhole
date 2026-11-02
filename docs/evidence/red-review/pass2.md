The user wants me to audit pass 1 findings against the code, confirm/reject each, then find new issues. But wait — the "PASS 1 FINDINGS" section appears to be empty! Let me re-read.

"=== PASS 1 FINDINGS ===" followed immediately by "===== FILE: contracts/keys/src/lib.rs =====". So the pass 1 findings list is empty — there are no findings listed. Hmm, that's odd. Let me look again carefully.

```
=== PASS 1 FINDINGS ===


===== FILE: contracts/keys/src/lib.rs =====
```

Yes, the PASS 1 FINDINGS section is empty. So I should note that there are no pass-1 findings to confirm/reject, and then do a fresh hunt.

Wait, maybe the intent is that the "PASS 1 FINDINGS" is the code itself? No, the code is labeled "then the code". So pass 1 findings are empty. I'll state that clearly and proceed to hunt.

Actually, let me reconsider — maybe the user intended to paste findings but they're missing. I should say "PASS 1 FINDINGS is empty — nothing to confirm/reject" and then do a thorough fresh audit.

Let me now hunt for real vulnerabilities in this code.

Let me analyze carefully.

### Contract (contracts/keys/src/lib.rs)

1. `nft_mint` — minter only, tier 1..3, token_id <= 64. `self.tiers.insert(&token_id, &tier)` happens BEFORE `internal_mint`. If internal_mint panics (e.g., duplicate token id, insufficient storage), the whole tx reverts, so tiers insert is rolled back. OK.

But wait: `internal_mint` measures storage and refunds excess. The tier entry storage is charged to the contract, not the minter. Comment says "minter-only, bounded". Fine.

2. `holder_tier` — uses `tokens_per_owner`. Returns max tier. OK.

3. `nft_payout` — royalty split. `balance.0 * royalty_bps / 10_000`. Potential overflow? balance is u128, royalty_bps max 1000. u128::MAX * 1000 overflows. But test uses `u128::MAX / 10_000`. In release wasm, overflow wraps (no panic) unless overflow-checks. Actually near-sdk builds with overflow checks? By default Rust release has overflow-checks off. So `balance.0 * 1000` could wrap for huge balance. But balance is U128 from caller in nft_payout (view, no auth). It's a view function so no state change; just returns wrong payout. Low severity. Actually nft_transfer_payout calls nft_payout with caller-supplied balance. The payout is used by marketplaces. Overflow could produce wrong split but sum still... hmm. Low/info.

4. `nft_transfer_payout` — calls `nft_payout` first (which reads owner), then `internal_transfer`. Note: `nft_payout` requires `max_len_payout` check. Then internal_transfer. The `sender` is predecessor. If sender != prev_owner (approved), authorized_id set. OK.

But there's a subtle issue: `nft_transfer_payout` computes payout based on `balance` provided by caller, and the royalty goes to treasury. Standard NEP-199. Fine.

5. `beat` — minter only, emits event. OK.

6. `set_minter` / `set_royalty` — owner only, 1 yocto. OK.

7. `new` — requires predecessor == current_account_id. OK.

8. `nft_resolve_transfer` — `#[private]`. OK.

Potential issue: `holder_tier` uses `tokens_per_owner.as_ref()?` — if `tokens_per_owner` is None (it's Some in new). OK.

Potential issue: The `tiers` LookupMap is never cleaned on burn — but there's no burn. OK.

Potential issue: `nft_mint` inserts tier before checking token_id uniqueness. If token already exists, internal_mint panics "token already exists" and reverts. OK.

Hmm, what about `nft_transfer_payout` — it calls `self.nft_payout` which does `self.tokens.owner_by_id.get(&token_id).expect("unknown token")`. Then internal_transfer. But between payout computation and transfer, no reentrancy (single tx). OK.

Actually a real issue: In `nft_transfer_payout`, the payout is computed for the *current* owner, but `internal_transfer` may fail if sender isn't owner/approved. That's fine, reverts.

Let me think about `holder_tier` returning max tier across all tokens. The TEE uses `holder_tier` to determine tier. If a user holds multiple keys, they get the best tier. But the custody wallet is per token_id. In `authenticate`, tier = holder_tier(account), and token = held_token (first key). So a user with a Gold key and a Bronze key: tier=3 (Gold), but token might be the Bronze key's token (first in enumeration). Then limits_now uses tier 3 caps but the wallet is the Bronze key's wallet. Hmm — is that a privilege escalation? The tier is used for limits. If you hold a Gold key, you get Gold limits on any of your keys' wallets. That might be intended ("best tier"). But the custody wallet bound to token... Actually the caps are per cap_id(token). So spending on the Bronze token's wallet uses Gold limits. Is that a problem? The Gold key holder is entitled to Gold limits. But they could spend Gold limits on the Bronze wallet, and also Gold limits on the Gold wallet (separate cap_id). So daily cap is per-token, not per-account. A holder of N keys gets N × daily cap. That's arguably intended (each key is a separate account). But the tier is the max, so a Bronze key gets Gold limits if you also hold Gold. Minor.

Actually more interesting: `held_token` returns the first token from `nft_tokens_for_owner` with limit 1. If a user holds multiple keys and wants to act on a specific one, they pass `params.token_id`. In `authenticate`:
```
let token = if !need_key && tier.is_none() { None } else if let Some(t) = s(&req.params, "token_id") {
    if owns(&t, &account)? { Some(t) } else { None }
} else { held_token(&account)? };
```
So if params.token_id is provided but not owned, token = None. Then for need_key ops, `if need_key && token.is_none()` → error not_owner. OK. But for `mint` (need_key=false), if tier is Some (already holder), token = ... wait mint checks `if c.tier.is_some() { return already_holder }`. OK.

Hmm, but note: if params.token_id is provided and NOT owned, token becomes None silently, and then `c.token_id()` falls back to `token_id_for(account)` — the derived id. For need_key ops that's blocked. But for `status` (need_key=false), token=None, so it uses tier_lim and no policy. Fine.

Wait, actually there's a subtle bug: for `status` with need_key=false, if tier is Some but params.token_id not owned → token=None. Then `c.token_id()` = token_id_for(account). `spent` reads cap for that derived token. Minor.

Let me focus on the TEE worker security.

### TEE worker (tee/worker/src/lib.rs and main.rs)

Key security properties:
- NEP-413 verification: checks signature, recipient, account binding. Does NOT check the public key belongs to the account — that's done in main.rs via `view_access_key` requiring FullAccess. Good.
- EIP-191: recovers address, must equal account_id (lowercase 0x). But does NOT check that the account actually owns the NFT? That's done via `owns()` in authenticate. OK.

Wait — for EIP-191, the account is an Ethereum implicit account `0x...`. The NFT owner would be that 0x account. `owns(token, account)` checks nft_token owner_id == account. OK.

But: EIP-191 does not verify the signing key is a "full access key" — it's an Ethereum address, no NEAR key. That's fine, the address is the account.

Hmm, but there's a critical issue: For EIP-191, `verify_eip191` checks `body.nonce == auth.nonce` and `body.recipient == auth.recipient`. Good. And `recover_eip191_address` recovers from `auth.message`. Good.

Now, replay: `consume_nonce` uses `set_if_absent` on `h/<account>/n/<nonce>`. Good, per-account nonce. But the nonce is 32 random bytes chosen by the client. If a client reuses a nonce across different ops... it's consumed once. Fine.

But wait — the nonce is consumed AFTER rate_limit. And `admit_request` is defined but... is it used? Let me check. `admit_request` is in lib.rs but I don't see it called in main.rs. The authenticate function does its own checks. `admit_request` seems dead code. Not a vuln.

Now the big one: **`authenticate` order**. Comment says "Signature -> key ownership -> freshness -> op binding -> tier -> rate limit -> nonce (replay)." Let's trace:
1. verify signature (nep413/eip191)
2. op binding check
3. view_access_key (for nep413)
4. chain_now_ms
5. check_freshness
6. holder_tier
7. token resolution (owns check)
8. rate_limit
9. consume_nonce

So nonce is consumed last. Good — a failed op doesn't burn the nonce. But rate_limit increments before nonce. If nonce is replayed, rate limit still counts. Minor.

Now, **the critical issue**: `consume_nonce` is called with `&mut Host`. But `Host` is a fresh struct each call. Storage is persistent (OutLayer encrypted storage). OK.

Let me look at `op_quote` with `execute: true`. It calls `enforce_caps(..., commit=true)` which increments the daily spend. Then if the real quote fails, it decrements. But if the real quote succeeds, the spend is committed. But a quote with execute=true creates an executable quote (deposit address) — does it actually move funds? The comment says "This route never creates an executable quote" for the web oneclick route, but the TEE `op_quote` with execute=true does `body["dry"] = false` and calls 1Click, returning a deposit_address. So the user gets a deposit address to send funds. The spend is committed at quote time. If the user never deposits, the daily cap is still consumed. That's a griefing/UX issue but the user did it to themselves. Actually it's the holder's own cap. Minor.

Hmm, but more importantly: `op_quote` with execute=true commits the spend, but the actual swap happens via 1Click deposit. The `op_swap` also commits spend. So a user could double-count? No, quote execute is a separate flow.

Let me look at **`op_swap`** and **`op_withdraw`** cap handling:
```
enforce_caps(&mut Host, &c.cap(), &lim, usd, c.now_ms, true)?;
let day_key = hkey(&c.cap(), &format!("spent/{}", c.now_ms / 86_400_000));
if let Err(e) = settle_if_owner(owns(&c.token_id(), &c.account)?) { let _ = Host.incr(&day_key, -(usd as i64)); return Err(e); }
```
Wait — `enforce_caps` uses key `hkey(account, "spent/<day>")` where account is `c.cap()` = `cap_id(token)` = `tok:<token>`. So the key is `h/tok:<token>/spent/<day>`. And `day_key` = `hkey(&c.cap(), ...)` = `h/tok:<token>/spent/<day>`. Same. Good, rollback works.

But `enforce_caps` in the non-commit branch (quote without execute) does `st.incr(&key, 0)` — reads. And in commit branch uses `bump_within`. OK.

Now, **`usd_of`** for a token: if token == USDC, returns amount parsed as u64. USDC has 6 decimals? Actually USDC on NEAR intents... `amount` is in base units. If USDC has 6 decimals, then amount in micro-dollars = amount. OK. But if the token is USDC with different decimals... The constant USDC is `nep141:17208628...` which is the USDC.e or native USDC. Hmm. `amount.parse::<u64>()` treats base units as micro-dollars. If USDC has 6 decimals, 1 USDC = 1_000_000 base units = 1_000_000 micro-dollars = $1. Correct.

But what if `amount` overflows u64? parse fails → error. OK.

Now **`op_withdraw`**: `assert_withdraw_to(&c.account, &to)` — `to` must equal signer account. But `to` is the destination on `chain`. If chain is Ethereum, `to` is an ETH address, but `c.account` is a NEAR account (or 0x for eip191). So for a NEAR account holder withdrawing to Ethereum, `to` must equal the NEAR account id — which is not a valid ETH address! So withdraw to another chain is broken unless the account is a 0x address. Hmm, that's a functional bug. Let me check: `assert_withdraw_to(signer, to)` requires `to == signer`. For a NEAR account like `alice.near`, `to` must be `alice.near`. But withdrawing to Ethereum requires an ETH address. So cross-chain withdraw is impossible for NEAR-account holders. That's a significant functional limitation / bug. Severity: medium (funds can only be withdrawn to same-named destination, which for non-EVM chains is impossible). Actually maybe intended: "Withdraw may pay only the account that signed the request." But it breaks cross-chain. Let me note it.

Actually wait, maybe the intent is that `to` is the account on the destination chain and they want to prevent withdrawal to arbitrary addresses. But then a NEAR user can't withdraw to Ethereum. Unless they use an eip191 account. Hmm. This is a real design issue. I'll flag as medium.

Now **`op_provenance`** — public, no auth. It calls `prov_sync_owner` which appends a "transfer" event if the last event owner differs. This is a **state mutation from an unauthenticated call**! Anyone can call `provenance` for any token_id, and it will append a transfer event (and save). This is a write amplification / griefing vector: an attacker can spam `provenance` to grow the log. But `prov_sync_owner` only appends if owner changed, so it's idempotent per owner change. Not unbounded. But it does write storage on a public endpoint. Also, `op_provenance` calls `chain_now_ms()` and `view` — RPC calls. Public endpoint → DoS via RPC. But the web gateway caches info, not provenance. Hmm, provenance is public and not cached. An attacker can spam it. Each call does RPC view + possibly storage write. Rate limited? The web gateway has perIp 20/min. But the TEE itself has no rate limit for provenance (no auth). So direct OutLayer calls could spam. But OutLayer requires payment key. The web gateway rate limits. Medium/low.

More importantly: **`prov_sync_owner` in `op_provenance`** — the "transfer" event is appended with `owner` = current on-chain owner and `ts` = now. But the detail is "transfer". This is used for cooldown. An attacker calling provenance right after a transfer would set the cooldown start time to the call time, not the actual transfer time. Actually `prov_sync_owner` is also called in `op_status` and `op_withdraw`. The cooldown is `last transfer event ts + 10 min`. If the transfer event is only recorded when someone calls status/withdraw/provenance, the cooldown starts at first observation, not actual transfer. That's a design choice (enclave can't know exact transfer time). But an attacker (new owner) could delay calling to... no, they want to withdraw, so they'd call and start cooldown. Actually the new owner wants to withdraw ASAP, so they call status → cooldown starts now → wait 10 min. Fine.

But here's a subtle attack: The **previous owner** could call `provenance` (public) right before transferring? No, prov_sync_owner only appends if owner changed. Hmm.

Wait, actually there's a bigger issue with `prov_sync_owner`: it's called in `op_provenance` (public) and appends a transfer event with `owner` = current owner. But what if the token is transferred back and forth? Each change appends. Fine.

Let me look at **`op_lock`**: sets lock for `hours`, `until = max(now + hours*3600000, cur)`. `cur` is active lock for current owner. So a holder can extend their own lock. A new owner's lock is separate (active_lock checks owner match). OK. But `op_lock` doesn't check cooldown or anything. Fine.

**`op_limits`**: set_policy. A raise waits 24h. A cut applies now. But note: `set_policy` computes `now = effective_limits(tier, cur, now_ms)`. If cur has a pending raise that's now effective, `now` reflects it. Then if new per_tx/daily <= now, applies immediately. OK.

But there's a subtle issue: a holder sets a pending raise (per_tx=100, daily=500) at T. At T+24h it's effective. But before T+24h, they set a cut to (1,1). `now` = effective_limits = current (tier caps, since pending not yet effective) → wait, `effective_limits` with pending not yet effective returns `(p.per_tx, p.daily)` which is the *current* (pre-raise) values. So `now` = current values. If cut (1,1) <= now, applies now, cancels pending. Good.

Hmm, what if they set a raise, then set another raise? `now` = current (pre-raise). New raise > now → pending with new effective_ms = now+24h. So the second raise resets the 24h clock. Fine.

Now **`effective_limits`** — `pt.min(tier.per_tx)`, `d.min(tier.daily)`. But it doesn't enforce `pt <= d` after min. If tier caps are per_tx=100, daily=500, and policy pending (per_tx=100, daily=500) — fine. But what if policy has per_tx=50, daily=10? set_policy requires per_tx <= daily. So stored policy always has per_tx <= daily. And min with tier preserves? pt.min(tier_pt) and d.min(tier_d). If pt <= d and tier_pt <= tier_d, then min(pt,tier_pt) <= min(d,tier_d)? Not necessarily! Example: pt=50, d=100, tier_pt=10, tier_d=1000. min=10, min=100. 10<=100 OK. Another: pt=50,d=60, tier_pt=100, tier_d=55. min(50,100)=50, min(60,55)=55. 50<=55 OK. Hmm, since pt<=d and tier_pt<=tier_d, is min(pt,tier_pt) <= min(d,tier_d)? Counter: pt=5, d=10, tier_pt=100, tier_d=8. min(5,100)=5, min(10,8)=8. 5<=8 OK. Try pt=9,d=10,tier_pt=100,tier_d=8: min=9, min=8 → 9>8! So per_tx=9 > daily=8. But wait, tier_d=8 < tier_pt=100 violates tier_pt<=tier_d. Tier caps: 1M/5M, 10M/50M, 100M/500M — all per_tx <= daily. So tier_pt <= tier_d always. Then min(pt,tier_pt) <= pt <= d, and min(pt,tier_pt) <= tier_pt <= tier_d. So min(pt,tier_pt) <= min(d, tier_d)? We have min(pt,tier_pt) <= pt <= d and <= tier_pt <= tier_d. So it's <= both d and tier_d, hence <= min(d,tier_d). Yes OK. Fine.

Now **`enforce_caps`** non-commit branch: `let v = st.incr(&key, 0)?; if v as u64 + usd_micro > lim.daily_usd_micro`. `v` is i64. If v is negative (shouldn't be), cast to u64 huge. But v is spend, non-negative. OK. Overflow: v as u64 + usd_micro could overflow u64 if both huge. usd_micro from quote, bounded by per_tx cap check first. per_tx <= 100M. v <= daily <= 500M. No overflow.

Now **`bump_within`** with `usd_micro as i64` — usd_micro is u64, could exceed i64::MAX? per_tx cap check ensures usd_micro <= per_tx_usd_micro <= 100M. So fine.

Now the **`op_swap` / `op_withdraw` rollback**: `Host.incr(&day_key, -(usd as i64))`. If the swap fails, rollback. But what if `wallet_op` returns status "success" but the actual swap failed? It trusts the status. OK.

Now, **critical**: `op_swap` calls `enforce_caps(commit=true)` which increments spend, then `settle_if_owner(owns(...))`. If not owner, rollback. Then `wallet_op`. If wallet_op errors, rollback. If status != success, rollback. Good.

But there's a **TOCTOU**: `owns()` is checked, then `wallet_op` is called. Between the check and the wallet op, the NFT could be transferred. But the wallet is bound to token_id, and the new owner would use the same wallet. So the old owner could initiate a swap, transfer the NFT, and the swap still executes on the wallet. But `settle_if_owner` re-reads ownership right before. Still a race window (RPC latency). The comment acknowledges "A transfer in between aborts the send." But it's not atomic. Medium? The window is small. Actually the bigger issue: the old owner signs a swap, the enclave checks ownership (still owner), then the old owner transfers the NFT in the same block... The enclave's `owns()` uses "final" finality, so it's ~2 epochs behind? No, "final" is finality final which is ~1-2 blocks. Hmm. Actually the check is at finality, so a recent transfer might not be visible. So the old owner could transfer and still swap. But funds stay in the wallet which now belongs to the new owner — so the old owner drains the new owner's wallet! Wait, the swap moves funds within the wallet (token_in → token_out), doesn't withdraw. So the old owner could swap the new owner's funds into a different token. That's a griefing/theft vector: after transferring the NFT, the old owner's in-flight swap executes on the wallet now owned by the new owner. But the old owner signed before transfer. The window is between signing and the enclave processing. Since the enclave checks ownership at processing time (finality), if the transfer is already final, it aborts. If not yet final, it proceeds. So there's a race. Severity: medium (requires precise timing, and the swap is within the account, not a withdrawal). Actually a swap could be used to convert to a token then... no withdraw. Hmm. But `copy` is also a swap. Low-medium.

Actually, more concerning: the **withdraw cooldown** is meant to prevent exactly this — after transfer, withdraw waits 10 min. But swap doesn't. So the old owner could swap (not withdraw). The new owner's funds get swapped. But the new owner still owns the resulting tokens. So it's just a forced trade. Medium/low.

Let me look at **`op_mint`** more carefully.

```
let c = authenticate(input, "mint", false)?;
if c.tier.is_some() { return already_holder }
```
`authenticate` with need_key=false. tier = holder_tier(account). If account holds any key, tier is Some → already_holder. Good.

But `authenticate` for mint: `let token = if !need_key && tier.is_none() { None } else ...`. For a new account, tier is None, so token = None. Then `c.token_id()` = token_id_for(account). OK.

Then minter balance check, daily mint quota, `assert_mint_id_free`. Then send tx.

**Issue**: `op_mint` is free (no payment). Global 25 mints/day. An attacker can mint 25 keys/day for free (each key is an NFT). Then... they hold keys. But each key gives access to a custody wallet. The mint costs the minter 0.012 NEAR deposit (refunded excess). So 25 mints/day × 0.012 NEAR = 0.3 NEAR/day from the minter. Plus gas. That's a cost to the protocol. An attacker could drain the minter's balance by minting 25/day. But it's capped. And the minter is refunded excess storage. Actually the deposit is mostly refunded (storage cost ~0.002 NEAR). So net cost ~0.002 NEAR per mint. 25/day = 0.05 NEAR/day. Minor.

But wait — **`op_mint` doesn't require the account to not already have minted and moved**. `assert_mint_id_free` checks if `nft_token(tid)` exists. If the account minted and transferred the key away, `nft_token(tid)` still exists (owned by someone else) → already_minted. Good. But if the account minted and the token was burned? No burn. OK.

Hmm, but `token_id_for(account)` = `k` + first 16 hex of sha256(account). Collision? 64 bits. Birthday collision at ~4 billion accounts. Unlikely. But an attacker could grind an account id that collides with a victim's token id? Account ids are limited (2-64 chars, lowercase alnum . - _). Grinding 64-bit collision is 2^64 work. Not feasible. OK.

Now **`held_token`** uses `nft_tokens_for_owner` with limit 1. If a user holds multiple keys, only the first is returned. The user can specify `params.token_id`. But `authenticate` checks `owns(&t, &account)`. Good.

Now let me look at the **`op_account`** deposit flow:
```
if let Some(chain) = s(&c.req.params, "chain") {
    let body = json!({"chain": chain, "token": ..., "amount": digits(...)});
    let (st, j) = http("POST", ".../confidential/deposit/cross-chain", Some(&key), Some(&body))?;
    ...
    prov_append(&c.token_id(), "deposit", &c.account, c.now_ms, &body.to_string());
}
```
`prov_append` with detail = body (chain, token, amount). This detail is stored and returned to the owner in `prov_body` (detail_for == owner). OK.

Now **`op_history`** returns `prov_body(&tid, Some(&c.account))` — includes details for rows where `ev.owner == c.account`. But `ev.owner` is the owner at the time of the event. If the current holder is the same as a previous owner (transferred back), they'd see their old details. Fine.

But wait — `prov_body` includes `detail` for rows where `detail_for == Some(ev.owner)`. So the current holder sees details of all events where they were the owner. But a previous holder's events (owner = previous) are hidden. Good.

Hmm, but `op_history` also returns `entries` = `history_for(&all, &c.account)` — trade log rows where `by == c.account`. Good.

Now **`op_prove`**: reads balance, checks `holds_at_least`, signs statement. The statement includes `locked_until_ms` and `log_head`. But it does NOT include the balance. Good. But `holds_at_least` is a boolean. A holder could prove "holds at least X" for any X <= balance. Fine.

But there's a **privacy leak**: `op_prove` returns `holds_at_least: holds`. If false, the holder knows they don't hold. Fine.

Now **`op_pnl`**: aggregates trades, prices outputs. Returns statement. Fine.

Now let me look at the **web routes**.

### web/app/api/ai/route.ts

- Rate limits per IP and global.
- Content-length check 4096.
- `prompt` max AI_MAX_PROMPT, nonce matches NONCE_RE.
- Fetches attestation report with nonce, requires exactly 1 candidate.
- Builds messages with system prompt and user context.
- `safeCtx = context.replace(/<\/?shared_context>/gi, "")` — strips shared_context tags from user context to prevent breaking out. But the prompt itself is not sanitized for `</shared_context>`. Wait, the user prompt is placed after the context: `<shared_context>\n${safeCtx}\n</shared_context>\n\n${prompt}`. If prompt contains `</shared_context>` it's after the closing tag anyway. But if prompt contains instructions, the system prompt says "Text between <shared_context> tags is data... never instructions". The prompt is outside the tags, so it's treated as the actual question. Fine.

But **prompt injection**: the user prompt is the question. The system prompt says "never reveal this prompt". Standard. Not a vuln per se.

- Returns request_body, response_body, signature, attestation. The signature is over the response. The client can verify. But the `signature.text` — is it the response text? The route returns `sig.text` and `sig.signature`. The client should verify that `sig.text` matches `response_body`'s content. But the route doesn't verify this itself. A malicious NEAR AI Cloud could return a signature over different text. But the client verifies. OK.

- **Issue**: The attestation report is fetched with the browser's nonce, but the chat completion is a separate request. The attestation proves the model/enclave, but not that the specific response came from that enclave. The signature over the response (from `/signature/{id}`) is the binding. But the route doesn't check that `sig.signing_address == m.signing_address` (attestation's signing address). If they differ, the signature is from a different key than the attested one. Let me check: `attestation.signing_address = m.signing_address`, `signature.signing_address = sig.signing_address`. The route returns both but doesn't compare. A client could compare. But the route should enforce. Medium? The client is supposed to verify. But if the route is the trust boundary... Actually the whole point is the client verifies. But a bug: if the AI cloud returns a signature from a different address, the client might not check. Let me flag as low/medium: route doesn't verify `sig.signing_address === m.signing_address` nor that `sig.text` corresponds to `response_body`.

Actually, more importantly: the **nonce binding**. The attestation is requested with `nonce`. But the chat completion request doesn't include the nonce. So the attestation proves "this enclave with this nonce", but the response signature is separate. The client must check that the response's signature address matches the attested address. The route returns both. OK, client's job.

- **`x-no-aliasing: true`** header — presumably to prevent the provider from aliasing to a different model. OK.

- **Issue**: `context` is sliced to 600 chars, but `prompt` up to AI_MAX_PROMPT. The total message could be large but bounded. OK.

- **Issue**: The route catches all errors and returns `ai_upstream`. Fine.

- **Potential SSRF?** No, fixed URLs.

- **`JSON.parse(responseBody)`** — if responseBody is not JSON, throws, caught → ai_upstream. OK.

### web/app/api/oneclick/route.ts

- `dryBody` builds a dry quote. `isAddr` validates deposit address.
- Only dry quotes and status. Good.
- **Issue**: `b.amount` is `String(b.amount ?? "")`. `dryBody` presumably validates. Let me assume it does (not shown). The route checks `body.dry !== true` → bad_params. OK.

- **GET status**: `isAddr(a)` validates. Then fetches status. Returns details. OK.

### web/app/api/worker/route.ts

- Rate limit per IP 20/min.
- Content-length 8192.
- `checkBody(raw)` validates op and auth presence.
- For `info`, caches 5 min.
- Forwards to OutLayer with payment key.
- **Issue**: `checkBody` validates that `auth.message`'s op matches. But it doesn't validate the signature (TEE does). OK.
- **Issue**: For `provenance`, it forwards `{op: "provenance", token_id: JSON.parse(raw).token_id}`. But `checkBody` for provenance doesn't require auth. And it re-parses raw. If `token_id` is missing, forwards undefined. TEE validates. OK.
- **Issue**: The route forwards `{op: c.op, auth: c.auth}` for other ops. But `c.auth` is the raw auth object. The TEE re-verifies. OK.
- **Issue**: `infoCache` is module-level, shared across requests. Fine.
- **Issue**: The `secrets_ref` includes `account_id: OUTLAYER_OWNER`. OK.

- **Potential issue**: The gateway allows `swap` and `withdraw` ops. `checkBody` requires auth with matching op. But the TEE also checks. OK.

- **Issue**: `checkBody` for eip191 requires fields `["scheme", "account_id", "address", "signature", "nonce", "message", "recipient"]`. But `verify_eip191` also needs `auth.scheme == "eip191"`. OK.

- **Issue**: For nep413, `checkBody` requires `public_key`. But `verify_nep413` uses `auth.public_key`. OK.

### web/lib/gateway.ts

- `ALLOWED_OPS` includes `copy`? No! `ALLOWED_OPS = ["info", "provenance", "status", "quote", "mint", "account", "balance", "history", "swap", "withdraw", "lock", "prove", "limits", "pnl"]`. **`copy` is missing!** The TEE supports `copy` (op_swap with op="copy"), but the gateway blocks it. So the `copy` feature is unreachable via the web gateway. That's a functional bug. Severity: medium (feature broken). Let me confirm: `run()` matches "copy" => op_swap(&input, "copy"). And `op_info` lists "copy" in ops. But gateway ALLOWED_OPS doesn't include "copy". So `checkBody` returns bad_op for copy. Confirmed bug.

- **Issue**: `checkBody` parses `a.message` and checks op. But for eip191, the message contains `nonce` and `recipient` fields that must match auth. The TEE checks. OK.

- **Issue**: `MAX_BODY = 8*1024` and route checks content-length > 8192. But `raw.length` is character count, not bytes. For multi-byte UTF-8, `raw.length` (chars) could be less than byte length. But content-length check catches bytes. OK.

Now let me think about **critical** issues.

**Critical candidate 1: `op_provenance` is public and mutates state (`prov_sync_owner`).** An attacker can call `provenance` for any token, causing `prov_sync_owner` to append a "transfer" event if the owner changed. This is a write. But it's idempotent. However, consider: the cooldown is based on the last "transfer" event's ts. If an attacker calls `provenance` for a token right after a transfer, the transfer event is recorded with ts = now. Then the new owner's withdraw cooldown starts at now. But if the new owner calls `withdraw` first, `prov_sync_owner` records it then. So the cooldown starts at first observation. An attacker could call `provenance` immediately after a transfer to start the cooldown early — but that only helps the new owner (starts cooldown sooner). Actually it could *delay*? No, it starts the cooldown at the earliest observation. So calling early starts cooldown early → new owner can withdraw sooner. Not an attack.

But wait — could an attacker **prevent** the transfer event from being recorded correctly? `prov_sync_owner` checks `rows.last().owner == owner`. If the last event's owner is already the new owner, it returns. So if an attacker calls provenance after transfer, it records transfer with owner=new. Then the new owner calls withdraw, sees last owner == new, no new event. Cooldown from the attacker's call time. Fine.

Hmm, but what if the token is transferred A→B→A? Events: ...owner A, then B (recorded), then A (recorded). `cooldown_until` finds the last "transfer" event and checks `last.owner == owner`. If last transfer event owner is A (current), cooldown applies. OK.

**Critical candidate 2: The `authenticate` function's `held_token` and tier mismatch.** Let me think about privilege escalation. A user holds a Bronze key (tier 1) and wants Gold limits. They can't, tier is from holder_tier. But what if they hold a Gold key and a Bronze key? tier = 3. They act on the Bronze key's wallet (first in enumeration) with Gold limits. But the Bronze key's wallet is theirs. So they get Gold limits on their Bronze wallet. Is that a problem? The Gold key holder is entitled to Gold limits. But the daily cap is per-token. So they get Gold daily cap on Bronze wallet AND Gold daily cap on Gold wallet = 2× Gold daily. That's a doubling. But they own both keys, so arguably fine. Low.

**Critical candidate 3: `op_quote` with `execute: true` commits spend but the quote is just a deposit address.** If the user requests an executable quote and never deposits, the spend is committed. But it's their own cap. However, an attacker could... no, it's authenticated. Low.

**Critical candidate 4: `usd_of` for USDC returns `amount.parse::<u64>()`.** If the token is USDC but the amount is in a different unit... The USDC constant is `nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. This is the NEAR USDC (6 decimals). So amount in base units = micro-dollars. OK. But what if a user passes `token_in = USDC` with a huge amount? parse to u64, then per_tx cap check. OK.

But **what if the token is NOT USDC but `usd_of` fails to get a price?** Returns error. OK.

**Critical candidate 5: `op_swap` `min_amount_out` is passed through without validation.** `if let Some(m) = s(p, "min_amount_out") { body["min_amount_out"] = json!(m); }`. The user sets min_amount_out. If they set it to 0, they accept any slippage. But that's their choice. The wallet's OutLayer policy might enforce. Low.

**Critical candidate 6: The `send` function nonce handling.** `let nonce = ak.pointer("/nonce")...; let tx = encode_tx(signer, &pk, nonce + 1, ...)`. It reads the access key nonce and uses nonce+1. If two txs are sent concurrently (e.g., two mint requests), both read the same nonce and both use nonce+1 → one fails with "nonce too small" or "invalid nonce". But the TEE is single-threaded per call? OutLayer might run concurrent calls. If two mints happen concurrently, one fails. The failed one returns mint_failed and decrements the quota. So the user retries. Minor. But could cause mint failures under load. Low.

Actually, more importantly: the minter key is a **full access key** on the minter account. The `send` reads the access key nonce. If the nonce is stale (cached), tx fails. But it reads "final". OK.

**Critical candidate 7: `minter()` key generation race.** 
```
let (mut sk, e) = storage::get(k);
if sk.len() != 32 {
    let mut seed = [0u8; 32];
    getrandom::fill(&mut seed)?;
    Host.set_if_absent(k, &seed)?;
    sk = storage::get(k).0;
    ...
}
```
If two concurrent calls both see sk.len() != 32, both generate seeds, both call set_if_absent. One wins, the other's set_if_absent returns false (already set). Then both read storage::get(k) → the winner's seed. So both use the same key. Good, set_if_absent handles the race. But wait — `Host.set_if_absent` returns Ok(bool). The code ignores the bool and re-reads. So both get the same key. OK.

But there's a subtle issue: if `storage::get(k)` returns an error "not found" and sk is empty, then generate. But if the storage has a partial/corrupt value (len != 32 but non-empty), it regenerates and set_if_absent fails (already set), then reads the corrupt value, len != 32 → error "minter key missing". So a corrupt value bricks the minter. Low.

**Critical candidate 8: `op_sweep_minter` is permissionless.** Anyone can call it. It checks if the enclave's minter is no longer the contract's minter, then sweeps the minter's NEAR to the current minter. If the enclave is still the minter, returns error. So an attacker can't sweep while it's the minter. But if the owner changes the minter (via set_minter), anyone can trigger the sweep. That's intended (recover funds). But the sweep sends to `cur` (the new minter from config). If the config's minter is an attacker-controlled account (owner set it), the funds go there. But the owner controls set_minter. OK.

But **`op_sweep_minter` is not in ALLOWED_OPS** in the gateway! So it's only callable directly via OutLayer. And it's permissionless. Fine.

Wait, actually `op_sweep_minter` is listed in `op_info` ops but not in gateway ALLOWED_OPS. So via web it's blocked. Direct OutLayer call possible. OK.

**Critical candidate 9: The `bind` output.** `out["bind"]` includes `req_sha256`, `nonce`, `account`, `token_id`. This is echoed for the client to verify the response is bound to the request. But `BIND` is a thread_local set in `authenticate`. For `info` and `provenance` (no auth), BIND is None. For provenance, no auth, so bind.account = None. OK.

But **`BIND` is set even on failed auth?** No, it's set at the end of authenticate after all checks. If authenticate fails, BIND stays None (or from a previous call in the same thread?). Since each call is a fresh process (stdin/stdout), thread_local starts None. OK.

Hmm, but if `authenticate` succeeds and then the op fails (e.g., bad params), BIND is set, and the error response includes bind. That's fine.

**Critical candidate 10: `op_status` calls `prov_sync_owner` which mutates state, and `op_status` is authenticated but need_key=false.** So a user with no key can call status? `authenticate(input, "status", false)`. If tier is None and need_key false, token = None. Then `c.token.as_ref().and_then(...)` → None, so no prov_sync. OK. But if the user has a key, prov_sync_owner runs. Fine.

**Critical candidate 11: `check_freshness` uses chain time.** `ts_ms + MAX_SKEW_MS < chain_now_ms || ts_ms > chain_now_ms + MAX_SKEW_MS`. So the request must be within 5 min of chain time. Good. But the nonce is consumed after freshness. If a request is signed with a future ts (up to 5 min ahead), it's valid for 10 min total (5 min before + 5 min after). Replay within that window is blocked by nonce. OK.

**Critical candidate 12: EIP-191 `is_eth_implicit`** requires lowercase 0x + 40 hex. But NEAR implicit accounts for ETH are `0x` + 40 lowercase hex. OK. But `auth.account_id.to_ascii_lowercase()` then `is_eth_implicit(&account)`. And `account != address` check. OK.

But **`verify_eip191` does not check that the account has a full-access key** — it's an ETH address, no NEAR key. The NFT owner is the 0x account. But how does a 0x account own an NFT? It must be minted to it or transferred. The mint uses `token_id_for(account)` and `receiver_id: c.account`. For a 0x account, `is_valid_account_id` — does it accept 0x...? `is_valid_account_id` checks lowercase alnum, `-`, `_`, `.`. `0x` + hex is alnum. Length 42. So valid. OK. But `nft_mint` on the contract requires `receiver_id: AccountId`. A 0x account is a valid AccountId (implicit). OK.

**Critical candidate 13: The `op_mint` for a 0x account.** `token_id_for(account)` = sha256 of the 0x string. Fine.

**Critical candidate 14: `holder_tier` in the contract uses `tokens_per_owner`.** But `tokens_per_owner` is only populated if the NonFungibleToken was created with `Some(Key::Enumeration)`. Yes, `Some(Key::Enumeration)`. OK.

Now let me look for **the big one**: Is there a way to bypass ownership?

`authenticate`:
```
let token = if !need_key && tier.is_none() { None } else if let Some(t) = s(&req.params, "token_id") {
    if owns(&t, &account)? { Some(t) } else { None }
} else { held_token(&account)? };
if need_key && token.is_none() { return not_owner }
```

For need_key ops, if params.token_id is provided and owned, token = Some(t). If not owned, token = None → not_owner. If not provided, held_token. Good.

But **`owns` uses `nft_token(token_id).owner_id == account`**. And `held_token` uses `nft_tokens_for_owner` then confirms with `nft_token`. Good.

Now, **the custody wallet is bound to token_id, not account**. So if Alice owns token T, she operates wallet(T). If she transfers T to Bob, Bob operates wallet(T). Good.

But **`custody_lookup` migration**: 
```
let legacy = kv.get(&hkey(owner, "wallet"));
if legacy.is_empty() { return None; }
let mk = hkey(owner, "migrated");
kv.set_if_absent(&mk, token.as_bytes())?;
if kv.get(&mk) != token.as_bytes() { return Ok(None); }
kv.set_if_absent(&k, &legacy)?;
```
So if the owner has a legacy wallet (from before the token-bound migration), it's migrated to the first token they access. But `set_if_absent(&mk, token)` — if the owner already migrated to a different token, `mk` = that token, and `kv.get(&mk) != token` → return None. So the legacy wallet is bound to one token. Good.

But **race**: two concurrent calls for the same owner with different tokens. Both see legacy, both set_if_absent(mk, token). One wins. The loser sees mk != its token → None. So the legacy wallet goes to one token. Good.

But **what if the owner has a legacy wallet and calls `op_account` for token A (migrates), then transfers token A to Bob, then calls for token B?** `mk` = A, so token B gets None → creates a new wallet. So the legacy wallet stays with A (now Bob's). Bob gets Alice's legacy wallet! That's a **fund leak**: Alice's legacy wallet (with funds) is bound to token A, and when Alice transfers token A to Bob, Bob gets the wallet. But that's the intended design ("transferring the NFT transfers the confidential account"). So Alice should withdraw before transferring. OK, intended.

But the migration is a one-time thing. If Alice had a legacy wallet with funds and migrates it to token A, then transfers A, Bob gets the funds. Alice's fault. OK.

Now, **`history_for`** filters by `by == signer`. The legacy log is copied with `by` = owner. So a new holder doesn't see old rows. Good.

Now let me look at **`op_withdraw` cooldown bypass**. `assert_no_cooldown(&evs, &c.account, c.now_ms)`. `evs` from `load_prov`. `cooldown_until` finds the last "transfer" event and checks `last.owner == owner`. If the last transfer event's owner is the current owner, cooldown applies. But **what if there's no transfer event yet?** `prov_sync_owner` is called before `load_prov` in `op_withdraw`:
```
prov_sync_owner(&c.token_id(), &c.account, c.now_ms);
let evs = load_prov(...);
assert_no_cooldown(&evs, &c.account, c.now_ms)?;
```
`prov_sync_owner` appends a transfer event if the last event's owner != current owner. So if the token was just transferred to the current owner, the first `op_withdraw` call appends a transfer event with ts = now, then cooldown = now + 10 min. So the current owner must wait 10 min from their first withdraw attempt. Good.

But **an attacker (previous owner) could call `op_provenance` (public) right after transferring, which calls `prov_sync_owner` and appends the transfer event with ts = now.** Then the new owner's cooldown starts at the attacker's call time. If the attacker calls immediately after transfer, cooldown starts immediately. If the attacker waits, cooldown starts later. But the attacker wants to... hmm, the attacker is the previous owner. They want to delay the new owner's withdraw? No, calling provenance starts the cooldown earlier, which helps the new owner. To delay, the attacker would NOT call provenance, and the new owner's first withdraw call starts the cooldown. So the new owner always waits 10 min from their first attempt. That's the design.

But wait — **can the new owner bypass the cooldown by calling `op_provenance` themselves?** No, that starts the cooldown. Can they avoid it? The cooldown is checked in `op_withdraw`. If no transfer event exists, `cooldown_until` returns None → no cooldown. But `prov_sync_owner` is called before the check, so a transfer event is always appended if the owner changed. So the cooldown always applies after a transfer. Unless... the transfer event was already appended by a previous call (e.g., `op_status` or `op_provenance`), and enough time passed. So the new owner could call `op_status` right after transfer (starts cooldown), wait 10 min, then withdraw. Same.

Hmm, but **what if the token was transferred and the new owner calls `op_withdraw` with a `ts_ms` in the future?** No, freshness limits to 5 min.

**What if the new owner calls `op_withdraw` and the transfer event is appended with ts = now, but