<p align="center"><img src="web/public/brand/keyhole-emblem.png" width="220" alt="KEYHOLE emblem"></p>

<h1 align="center">KEYHOLE</h1>

<p align="center"><b>KEYHOLE turns a private trading account into an NFT: sell the NFT, and the account, its history and its limits move to the buyer, while the seller is refused on the very next request.</b></p>

<p align="center">Live on NEAR mainnet. Account operations run in an Intel TDX enclave on OutLayer, and every refusal is attested and checkable.</p>

<p align="center">
<a href="https://github.com/mohamedwael201193/keyhole/actions/workflows/ci.yml"><img src="https://github.com/mohamedwael201193/keyhole/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
<a href="https://nearblocks.io/address/keyhole-devmo.near"><img src="https://img.shields.io/badge/NEAR%20mainnet-keyhole--devmo.near-00EC97" alt="Keys contract on NEAR mainnet"></a>
<a href="https://www.getkeyhole.xyz"><img src="https://img.shields.io/badge/live%20app-getkeyhole.xyz-111111" alt="Live app"></a>
</p>

<p align="center">
<a href="https://www.getkeyhole.xyz">Live app</a> ·
<a href="https://www.getkeyhole.xyz/verify">Verify a TEE call</a> ·
<a href="https://nearblocks.io/address/keyhole-devmo.near">Keys contract</a> ·
<a href="VERIFY.md">Verify the deployment</a>
</p>

Live contract v2.7.0 on NEAR mainnet: code hash `3cZsaySYgqZntFaRKEUffQUMGqRjkQ2DuSmFWXwiKGZH` ([deploy](https://nearblocks.io/txns/6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h)). Contract source candidate **2.7.0**, matches live deployment. Live worker `0d645930…a9305a` (1,379,425 bytes, [publish](https://nearblocks.io/txns/7TMAjPuWT1auMme1VYqfjMLwJphgcMucj8g4ig4gvE1T)). Supply **8** (`nft_total_supply`, read live 14 Nov 2026). Lending is off. Author and deployer: **devmo** ([`keyhole-devmo.near`](https://nearblocks.io/address/keyhole-devmo.near)).

**Contents:** [Try it](#try-it-5-minutes) · [Proof](#proof) · [How it works](#how-it-works) · [Lock / no-rug](#lock--no-rug) · [Loans](#loans) · [Video](#video) · [Known issues](#known-issues) · [Real vs simulated](#real-vs-simulated) · [Repo map](#repo-map) · [License](#license)

## Try it (5 minutes)

No wallet, no Rust, no `npm install`. You need `curl`, `bash` and `python3`.

Step 0 checks out the pinned review commit `de5a35159c399f23138d6eea41bac3b921109b98` (from [`identity.json`](identity.json)), not HEAD, so the checks below run against the exact source that was reviewed — HEAD moves, the pinned commit does not.

<!-- keyhole-fence: safe -->
<!-- VERIFY-CHECKOUT:START -->
```bash
git init keyhole && cd keyhole
git remote add origin https://github.com/mohamedwael201193/keyhole.git
git fetch --depth 1 origin de5a35159c399f23138d6eea41bac3b921109b98
git checkout --detach FETCH_HEAD
test "$(git rev-parse HEAD)" = "de5a35159c399f23138d6eea41bac3b921109b98"
```
<!-- VERIFY-CHECKOUT:END -->

1. **Run the live check.** Do: `bash verify/0-live.sh`. See: `PASS` for each step — on-chain `code_hash` equals `3cZsaySY…KGZH`, supply **8**, owner, minter `015a0259…c443`, and a valid TDX attestation for the live `info` call; exit 0. (No git? Download the source tarball from the pinned commit — see [AGENTS.md](AGENTS.md).)
2. **Watch a real handover.** Do: open [getkeyhole.xyz/attack](https://www.getkeyhole.xyz/attack). See: the key moves A → B in one transfer ([tx `G35r5pmC…`](https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD)); A's withdraw before it is ok, A's next withdraw after it is refused `not_owner`; every card links its attestation. <!-- TODO(H): replace with the newest handover tx hashes once H lands. -->
3. **Verify one attested call.** Do: open [getkeyhole.xyz/verify?call=2220caa1-90ad-42a6-b281-cfd08cd1b354](https://www.getkeyhole.xyz/verify?call=2220caa1-90ad-42a6-b281-cfd08cd1b354). See: a valid TDX quote, `executed_wasm_sha256` = `0d645930…a9305a` = the worker in [`identity.json`](identity.json).

More checks: Claims machine (446 claims): `node verify/verify-claims.mjs --offline` → **446 claims: 178 PASS, 0 FAIL, 0 ERROR, 268 SKIP** (**446**: offline 178 PASS, 0 FAIL, 0 ERROR, 268 SKIP). `bash verify/1-contract.sh --strict` (committed wasm == chain), `bash verify/2-attestations.sh` (every recorded call). Full instructions: [AGENTS.md](AGENTS.md).

## Proof

Every row is a mainnet transaction or an attested TEE call. Full history, including earlier builds, is in [docs/IDENTITY.md](docs/IDENTITY.md).

| Claim | Evidence | Check it |
|---|---|---|
| Contract v2.7.0 live on mainnet | code hash `3cZsaySY…KGZH` | [deploy `6rD2iMs1…`](https://nearblocks.io/txns/6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h) · `bash verify/0-live.sh` |
| Worker `0d645930` published | add_version tx | [`7TMAjPuW…`](https://nearblocks.io/txns/7TMAjPuWT1auMme1VYqfjMLwJphgcMucj8g4ig4gvE1T) · info call [`2220caa1`](https://api.outlayer.ai/attestations/by-call/2220caa1-90ad-42a6-b281-cfd08cd1b354) |
| Mint signed in the enclave | key `k5f4750858f328940` | [tx `DJxbuaJV…`](https://nearblocks.io/txns/DJxbuaJVAhwBrK9xne1t623XuL8dMSm8So3eEVtZpHgF) |
| Handover A → B, seller refused after | transfer + `not_owner` | [tx `G35r5pmC…`](https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD) · before [`440c2378`](https://www.getkeyhole.xyz/verify?call=440c2378-6c27-49fd-8b6b-d74054f331ae) ok · after [`e805f050`](https://www.getkeyhole.xyz/verify?call=e805f050-d416-4a04-9b12-270adbe02068) `not_owner` · [evidence](docs/evidence/ownership-and-limits/README.md) |
| Sale via NEP-178 direct approval | approve → pay 0.1 NEAR → transfer → revoke | transfer [`F52PyT43…`](https://nearblocks.io/txns/F52PyT43rVizWmkcJVxbcKuj7n3KZFK5GQsNyuiXY2iT) |
| 1Click cross-chain, SUCCESS | 0.004 SOL → 0.367068 USDC | NEAR [`8BQznSfb…`](https://nearblocks.io/txns/8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh) · [evidence](docs/evidence/oneclick-sol/README.md) |
| 1Click REFUNDED (`NO_LIQUIDITY`) | 0.00089235 SOL returned | SOL [`5qumXJw4…`](https://solscan.io/tx/5qumXJw4bCdfGzSbVP4Vas12JMkxWEuqaPpzWhHKoTYmxpifbowQKuL1hv9WxyMd9TrNe93WrivimTUcEcok7tPy) |
| Prompt-injection refusal | poisoned note: pay `attacker.near` refused | [`c1312e2d`](https://www.getkeyhole.xyz/verify?call=c1312e2d-8c20-4b3e-ad5b-22dd3102826d) `bad_params` · [evidence](docs/evidence/prompt-injection/README.md) |
| Lost payout recovered | 0.02124 NEAR paid to the minter | tx [`J5dHg2q…`](https://nearblocks.io/txns/J5dHg2qran5QaHuizajA4vCzJjeU8g8BVPaTUUBXzEvi) — rebroadcast via public RPC 22:44:57 UTC Nov 13, block 224428029 |
| Loans A + B | <!-- TODO: tx hashes once on-chain --> | — |
| Handover H (token 0) | <!-- TODO: tx hashes once on-chain --> | — |
| Lock + key deletions | <!-- TODO: tx hashes once on-chain --> | — |

History: worker version r5 (`1992b736…`) was added 21:43 UTC Nov 13, active 41 minutes, set inactive 22:24 UTC ([`HHN5SC6U…`](https://nearblocks.io/txns/HHN5SC6UGifXQJCbQ6GcC72mH7AaPYyxxCJoJB2Wcyck)), and removed 23:09:45 UTC ([`C4mjHMwU…`](https://nearblocks.io/txns/C4mjHMwURnRPC5JTN7jegEj3zBSqhKrMcs6CgDnxY6kC)). The registry is a singleton again (active `0d645930` only). The r5 export op was used once, to recover the lost payout above.

Collateral provisioning is an internal reproducible review of the repository, not an external audit — see [docs/IDENTITY.md](docs/IDENTITY.md) ([R2 map](docs/evidence/worker-provisioning/R2.md)).

## How it works

- **One key, one account.** Each NFT maps to one confidential custody wallet inside the Intel TDX enclave. Transfer the NFT and the wallet moves with it; the balance does not change.
- **Owner check on every request.** The worker reads the owner from `keyhole-devmo.near` on each signed request, and again just before a swap or withdraw is sent. The old owner is refused `not_owner`.
- **Caps and cooldowns.** Bronze: $1 per trade, $5 per UTC day. A new owner cannot withdraw for 10 minutes. Holder caps can be cut at once; a raise waits 24 hours.
- **Everything is attested.** Every call returns a TDX quote with the executed wasm hash. Check any call at `/verify?call=<id>`.
- **Built-in sale.** `nft_list`, `nft_unlist` and `nft_buy` are in the contract; a listed key's account is frozen for value moves.

```mermaid
flowchart LR
  H["Holder wallet<br/>signs NEP-413 or EIP-191 (no gas)"] -->|"POST /api/worker {op, auth}"| G["Website gateway<br/>allowlist, 8 KB limit, 20 calls per minute per IP"]
  G -->|"adds the payment key on the server"| T
  subgraph TEE["OutLayer Intel TDX enclave, KEYHOLE worker"]
    T["Worker<br/>signature, nonce, freshness, owner, caps, rate limit"]
    CW[("Custody wallet per token_id<br/>key sealed in enclave storage")]
    T --- CW
  end
  T -->|"nft_token owner, holder_tier, nft_mint"| K[("keyhole-devmo.near<br/>keys NFT")]
  T -->|"quote, swap, withdraw"| I[("NEAR Intents 1Click<br/>solvers see the pair and amount")]
  T -->|"reply + attestation (TDX quote, executed wasm sha256)"| B["Browser verifier /verify<br/>TDX quote, FastFS wasm, Intel PCS"]
```

Details, ops, caps and the full request-check order: [docs/IDENTITY.md](docs/IDENTITY.md) and [SECURITY.md](SECURITY.md).

## Lock / no-rug

<!-- TODO(LOCK): fill with real tx hashes + the empty-key verification only after the lock lands and the user approves. Do NOT ship "no keys" before view_access_key_list returns empty. -->

The contract enforces the lock in two steps. First, ownership moves to a lock account (`ee91dc…`) via `propose_owner` + `accept_owner` after a 24-hour timelock — the timelock elapsed 22:55:39 UTC Nov 13 and the owner is still the guardian (`0705fdc1…`). Second, every access key on `keyhole-devmo.near` is deleted, so no one can deploy new code to the contract account again. Verify the end state yourself:

```bash
# expect: no keys on keyhole-devmo.near (and none on the lock account, once its key is deleted)
curl -s https://rpc.mainnet.near.org -X POST -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"t","method":"query","params":{"request_type":"view_access_key_list","account_id":"keyhole-devmo.near","finality":"final"}}'
```

What stays true after the lock: the contract keeps working for everyone from their own accounts (NFT, vault, loans); the worker keeps running while OutLayer credit lasts. What stops: no upgrades, no worker or secrets updates, no transfers from `keyhole-devmo.near`. The guardian's only remaining power is `recover_treasury` (timelocked, treasury is 0, it cannot move tokens or upgrade). The full lock proof (transactions + key-list reads) lands with the lock.

## Loans

<!-- TODO(LOANS): fill with real tx hashes once loans A+B are on-chain. -->

Lending is **off** on mainnet. The contract supports guarded loans against a key's whole account as collateral: borrow NEAR without publishing the full balance; miss repayment and the lender can claim the entire account. The first mainnet loans are being executed now; their transaction hashes land in the proof table above when they are final. After them, lending stays off.

## Video

<!-- TODO(VIDEO): link once the video is recorded (after the lock, so it shows the locked state). -->

## Known issues

- **Stuck payout, recovered.** The OutLayer host RPC returned Ok on an error JSON, so a minter payout never landed and its journal blocked new mints. Recovered with a read-only export op plus a public-RPC rebroadcast ([tx `J5dHg2q…`](https://nearblocks.io/txns/J5dHg2qran5QaHuizajA4vCzJjeU8g8BVPaTUUBXzEvi)). Root cause in [SECURITY.md](SECURITY.md).
- **Two stranded collateral wallets.** 1,799,636 raw USDC (~1.80 USDC) sits in two confidential wallets no current worker can spend, because each wallet is bound to a superseded worker hash. See [SECURITY.md](SECURITY.md) (§ Stranded collateral wallets).
- **Cap leak (F11).** A failed swap did not release its $0.01 daily-cap hold. The leak is bounded by the $5 daily cap and resets at 00:00 UTC. See [SECURITY.md](SECURITY.md).
- **After the lock**, a stuck minter ticket clears only by expiry (~13.7 h) — the export tool needs `keyhole-devmo.near` keys, which will be gone. See [SECURITY.md](SECURITY.md).
- Older mint metadata uses the phrase "viewing key"; the key is a control key.

## Real vs simulated

| What | Status | Where to check |
|---|---|---|
| NFT contract `keyhole-devmo.near` on mainnet | **Real mainnet** | [/verify](https://www.getkeyhole.xyz/verify) · `bash verify/1-contract.sh` |
| TEE worker published on OutLayer | **Real mainnet + attestation** | [/verify](https://www.getkeyhole.xyz/verify) · OutLayer attestation API |
| Mint, swap, withdraw, transfer, freeze, caps | **Real mainnet** (tiny amounts) | [Proof](#proof) · evidence under `docs/evidence/` |
| Attested refusals | **Real mainnet attestations** (recorded on previous builds, labelled on each card) | [/attack](https://www.getkeyhole.xyz/attack) |
| Key handover transfer A→B | **Real mainnet tx** | [tx `G35r5pmC…`](https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD) |
| Claims machine | **File checks reproduced offline** | `node verify/verify-claims.mjs --offline` (skips are live checks: mainnet, site, attestations, CI) |
| Demo vault replay on [/demo](https://www.getkeyhole.xyz/demo) | **Recorded replay** (read-only) | Labelled as demo; does not move funds |
| Free trial on [/try](https://www.getkeyhole.xyz/try) | **Real testnet** for the key; the vault trade is a **recorded mainnet** swap, labelled so | [`docs/trial/testnet.json`](docs/trial/testnet.json) |
| Pledge dashboard (`/pledge`) | **Preview — in review · not live** (CTA disabled; lending off) | [/pledge](https://www.getkeyhole.xyz/pledge) |
| Market demand / unrelated-party volume | **Not claimed** | Demo sizes stay tiny; no invented PnL |

Caveats that are not features live in [SECURITY.md](SECURITY.md).

## Repo map

```
contracts/keys/       NFT contract (+ deployed/ wasm, release/ wasm for each version and SHA256SUMS)
contracts/keys-sandbox/  near-workspaces upgrade and sale tests
tee/worker/           TEE worker (Rust, wasm32-wasip2), build.sh, DEPLOYED_SHA256, verify-log.mjs
cli/                  keyhole CLI and MCP server (TypeScript)
web/                  website and gateway (Next.js), tests/, e2e/, screenshots/
verify/               verification kit (wrappers for 0-live, 1-contract, 2-attestations, claims checker)
docs/                 claims.json, COSTS_AND_RISK.md, IDENTITY.md (live identities, build history), evidence/ (mainnet proofs)
scripts/              identity generator, attack demo, test count
security/             shared counterparty blocklist
skills/keyhole/       agent skill file
identity.json         single source of build identities
verify.sh             one-call verifier (attestation, FastFS, optional rebuild)
```

**Tests** (from the pinned review commit; re-verified at PR time): keys contract 342 unit + 62 sandbox; TEE worker 758; CLI 81; web 2032 in 124 files; web e2e 221 pass, 15 opt-in skipped. CI runs six jobs on every push to `main` (contract, worker, cli, verification kit, hygiene, web).

## License

**Licence:** [MIT](LICENSE). Copyright 2026 devmo. Author and deployer: devmo ([`keyhole-devmo.near`](https://nearblocks.io/address/keyhole-devmo.near)). Built on NEAR.

History and contributions: [CONTRIBUTIONS.md](CONTRIBUTIONS.md). Proof index: [PROOFS.md](PROOFS.md). Source history starts at [`66f7070`](https://github.com/mohamedwael201193/keyhole/commit/66f7070); the reviewed baseline is the [compare](https://github.com/mohamedwael201193/keyhole/compare/7a8ec4a...d451a25bab95817e73585dd5db3c323e230a9140).
