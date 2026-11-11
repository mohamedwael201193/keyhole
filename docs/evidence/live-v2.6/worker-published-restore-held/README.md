# Worker publication FINAL; restoration correctly held

Final chain check: **2026-11-11 01:43:27 Africa/Cairo**, finalized block **223986608**. Production check: **01:42:21 Africa/Cairo**. No push.

## Outcome / exact stop

The v2.6 contract remains live, the reviewed worker is now the **only active registered version**, and lending remains **OFF**. The actual current-holder, strict guarded `withdraw_dry_run` succeeded without broadcasting a withdrawal: input100000 USDC base units, output100000, minimum99000, receiver `keyhole-devmo.near`, token0/epoch0. However, its genuine provider result has **`deadline:null`, `estimated_fee:null`, `fee_token:null`**.

The unchanged reviewed restoration gate therefore returns **FAIL**: four gates PASS, only **`exit_route_fee_deadline` FAIL** (`scripts/release/gates.mjs:594-601`, “real exit fee/deadline absent”). No fee/deadline was invented and no reviewed contract/worker/gate semantics were changed. **No worker-identity promotion and no maintenance-OFF production deploy were attempted.** Production `/` is200; `/api/keyhole` and `/api/worker` remain **503 + no-store**. The successful backend preview is not misrepresented as a production gateway read-flow PASS. No additional paid attempt followed this real gate failure.

## Original secret-merge HTTP400 resolution

The original CLI did **not retain its exact HTTP response body or original signed wire request**; these cannot be recovered retroactively. The redacted request in `operator-resolution.json` is reconstructed from the invocation and official source, not claimed as a wire capture. [Official v0.2.2 NearSigner](https://github.com/out-layer/outlayer-cli/blob/v0.2.2/src/near.rs) uses `broadcast_tx_commit` for the native `store_secrets` dispatch. The error’s “Transaction failed” context is that native RPC call, not a payment-key/project/keystore request-validation failure.

Fresh **non-dispatchable one-byte** diagnostics reproduce dRPC HTTP400 with the exact body `{"id":"keyhole-invalid-one-byte-format-diagnostic","jsonrpc":"2.0","error":{"message":"method is not available","code":-32601}}` for both legacy and named parameter forms. dRPC `send_tx` reaches Borsh validation; FastNEAR’s legacy method also reaches Borsh validation. No diagnostic contains a signed transaction. See the retained complete request/response bodies.

At **01:33:56 Africa/Cairo**, fresh canonical finalized block223985605 still showed owner nonce221777577000134 and unchanged secret metadata. Together with the earlier220-block scan, the explicit operator resolution was appended separately as **`REJECTED_400_NOT_DISPATCHED`**; the original UNKNOWN WAL and scan were preserved. The correction was exclusively the official CLI’s supported `OUTLAYER_RPC_URL=https://free.rpc.fastnear.com`. Exactly **one** corrected secret merge was made, merging only the approved public guarded hash and preserving the original default profile, accessor, owner whitelist, null vault and every other value. It is **FINAL_SUCCESS**, with current ciphertext equal to that original action’s ciphertext. No second corrected attempt occurred.

OutLayer’s replacement row advances both generated timestamps; that is not an access-policy change. Private read-only verification initially referenced absent journal fields, incorrectly expected creation-time stability and decoded a base64 string literally. These local assertions were corrected to match the reviewed collector; no extra transaction was dispatched. The unchanged release collector independently passes `secret_storage_and_actual_refund`.

## Original transactions and measured native fees

All times below are **2026-11-11, Africa/Cairo**. Each original receipt graph is terminal/closed. dRPC408 sends were resolved using only the corresponding original hash, never rebroadcast. Initial and replacement FastFS calls deliberately use gas1 and therefore have the documented native failure status; only the replacement pair assembled the valid artifact.

| Operation | Original hash | Status | Cairo time | Burn NEAR |
|---|---|---|---|---:|
| code-only deploy | `4XrNsFhgRrapQii14PYYc215cVEzZ8wubs3fytM3YAPj` | FINAL_SUCCESS | 01:11:39 | 0.003536916508618 |
| initial upload1 | `Fm5j4jfF933r9jqZDHy3d2Ph1scmMVt6h3KMZfLABWd3` | FINAL_GAS1_FAILURE; invalid nonce discarded | 01:16:20 | 0.0053547004665248 |
| initial upload2 | `J581HTWGiV7NVJjMFKtrWqaJAbqdTSRDsjbAyE5dCCU4` | FINAL_GAS1_FAILURE; invalid nonce discarded | 01:16:44 | 0.0003037355333717 |
| replacement upload1 | `8wfH4CYGksrqT9L6SvKSzJYJYyUcKwLMpg18V959CYMY` | FINAL_EXPECTED_GAS1_FAILURE | 01:25:53 | 0.0053547004665248 |
| replacement upload2 | `GTBXzw5izJCSc5J19q5X7YyrzwcXtjPaSv2q1M6Bh2nU` | FINAL_EXPECTED_GAS1_FAILURE | 01:26:03 | 0.0003037355333717 |
| corrected secret merge | `6xYeVLj6RJ6SFYWH1WxWcNL7oAP5fnoM6up6bHuPJCJk` | FINAL_SUCCESS | 01:33:58 | 0.0003637764442522 |
| registry5 actions | `3emr8M4RZUapyGWynK5r3MhtAEA7R3SMzzdEEY4u8i9P` | FINAL_SUCCESS | 01:36:21 | 0.0019069645675134 |
| registry9 actions | `BYmQZoH5tVHyAuVNQBXWBuMf8LfvX18AUr5VH93zmLHx` | FINAL_SUCCESS | 01:36:45 | 0.0034622785779344 |
| registry9 actions | `ASrFYcEWadak9pF9vPpyfG6KhvyuCCtB7XmYtangTWWQ` | FINAL_SUCCESS | 01:36:59 | 0.0031387263723977 |

**Cumulative native burn: 0.0237255344705087 NEAR**, below0.1, including both discarded initial uploads. Contract code storage backing0.01405 NEAR separately. New version retains exactly **0.0044 NEAR**. All22 removals produced verified storage transfers, not gas refunds: batch refunds **0.0176 / 0.0396 / 0.0396 = 0.0968 NEAR**. Secret attachment0.1 plus previous storage0.01091 minus actual new storage0.01211 yielded the verified **0.0988 NEAR** transfer; net additional secret storage0.0012. **Total confirmed storage/excess refunds0.1956 NEAR**, distinct from gas refunds.

The single code-only deployment used88 blocks from fresh capture to execution; corrected merge7. All registry transactions used dRPC consistently and executed11/53/79 blocks after the canonical22-version capture. Fresh signatures were generated sequentially only after the previous original became FINAL and its exact refunds/intermediate registry were checked. Registry counts19 →10 →1; UUID `p000000000000004b` preserved. The current artifact still resolves HTTP200, **1085333 bytes**, SHA256 **62398a8aa0451ce58cb5ab814ad8dc7f4e2f3fc55ce874c7672ea986abcc307f**.

## Compute, gates and checks

Exactly two asynchronous paid calls, exact reviewed version/default secrets, existing payment owner `keyhole-devmo.near`, nonce1; no developer deposit or top-up:

| Operation | Original call ID | Ceiling microUSD | Actual microUSD |
|---|---|---:|---:|
| info | `f43c0dc6-d34a-4c86-b189-2b7feba9b0fa` | 40000 | 1003 |
| withdraw_dry_run | `36a2f1be-77ec-44c0-a043-43cd5c6f19b3` | 10000 | 1009 |

Both completed successfully and have public measured attestations binding exact project, registered/executed worker hash and original input/output commitments. Combined cost **2012 microUSD = $0.002012**; authorized ceilings total$0.05,2/20 calls. Remaining available payment balance **$0.512645**, reserved0. The official status command initially needed an `outlayer.toml`; supplying its local project config and polling the same original IDs did not execute another call.

- Original deployment/predeploy/post/deploy-post proofs retained; historical approvals used only as original checkpoint evidence.
- Fresh current maintenance/drain and publication envelopes and acknowledgements remain private outside Git.
- Current restoration: original deploy-post checkpoint PASS; maintenance/drain PASS; singleton/guarded restore PASS; actual secret/refund PASS; **exit route fee/deadline FAIL**. No successful restoration checkpoint minted.
- **Strict online contract judge PASS on dRPC**, including exact bytes/codehash/version/minter. The only current executable code change is an honest identifying urllib User-Agent, with a regression test retaining the pinned assertions.
- **109 release/pledge tests PASS,0 FAIL**. Earlier bounded FastFS planner repair and regressions remain in commit090c97e.
- Latest complete on-chain raw rows, all six NFTs/owners, controls/epochs, credits and configs are preserved against the original capture. Lending OFF; no new/migrate/migrate_pledge, loan, rollback, key mutation or push.

The previous [secret-held record](../replacement-upload-secret-held/README.md) remains a historical checkpoint, superseded by this separately appended operator resolution and actual FINAL results. Saved signatures, original encrypted secret transaction bodies, credential stores and full fresh packets are never committed. This directory contains only sanitized public evidence.
