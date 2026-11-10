# Replacement FastFS upload PASS; original secret merge unresolved

Final observation: **2026-11-11 01:30:41 Africa/Cairo**. This is not ordinary-service restore PASS. Maintenance remains ON; lending remains OFF. No push.

## Planner repair and proof

Commit `090c97e963f689aa93b7a84e0feceeec81443377` validates integer nonces in **1..2147483647**, adds bounded seconds-based derivation and a persisted previous-indexed-nonce uniqueness guard, and covers overflow/boundary/exhaustion cases. A negative lifecycle test now explicitly uses its historical pre-upgrade identity instead of assuming the production identity is still v2.5. All **108 pledge/release tests PASS**. No contract, custody, value or loan semantics changed.

Upstream rules were checked, not guessed: [indexed row key](https://github.com/fastnear/fastdata-indexer/blob/187d80e84dc3db8411a1f69854b77d990ad6c721/fastfs-sub-indexer/src/scylla_types.rs) is predecessor/current-account/path/offset; [assembly](https://github.com/fastnear/fastfs-server/blob/2f7a2f41e6275140a34e88b3dbd9ffebf705d4ea/src/main.rs) matches part nonces, not highest numeric nonce. The prior overflowing batch was rejected before storage. Replacement nonce **1794353148** is unique for this path and valid. Previous invalid originals/journals were never overwritten.

## Approved replacement uploads

| Operation | Original hash | Native status | Time | Burned fee NEAR |
|---|---|---|---|---:|
| replacement-upload-1 | `8wfH4CYGksrqT9L6SvKSzJYJYyUcKwLMpg18V959CYMY` | FINAL_EXPECTED_GAS1_FAILURE | 2026-11-11 01:25:53 Africa/Cairo | 0.0053547004665248 |
| replacement-upload-2 | `GTBXzw5izJCSc5J19q5X7YyrzwcXtjPaSv2q1M6Bh2nU` | FINAL_EXPECTED_GAS1_FAILURE | 2026-11-11 01:26:03 Africa/Cairo | 0.0003037355333717 |

Both fees are below **0.01 NEAR each**. HTTP408 send responses were resolved only by reading those original hashes; no rebroadcast occurred. At **01:26:12 Africa/Cairo**, the public artifact resolved **HTTP200**, exactly **1,085,333 bytes**, SHA256 **62398a8aa0451ce58cb5ab814ad8dc7f4e2f3fc55ce874c7672ea986abcc307f**, with the correct nonce and two FastFS parts. The clean URL also returned200 before the next step. No further re-upload was needed.

Known cumulative burn, including code deployment and both invalid and replacement upload pairs: **0.014853788508411 NEAR**. Contract code storage backing remains **0.01405 NEAR** separately. Confirmed refunds so far: **0 NEAR**. No paid compute, registry publication or retirement occurred.

## Next real stop condition: original official secret updater

The existing official CLI, with `OUTLAYER_RPC_URL=https://near.drpc.org`, was invoked **once** at **2026-11-11T01:27:00.819941+02:00**, merging only the approved public `GUARDED_WORKER_HASH` while preserving existing values/access. It reported:

```
Signing update request...
Updating secrets...
Error: Failed to store updated secrets
Caused by:
    0: Transaction failed
    1: the server returned status code 400 - bad request
```

No transaction hash was returned. The signer/public-key/next-nonce and canonical before context were durably journalled before the invocation. A bounded original-hash recovery scanned **220 canonical blocks (223984828..223985047)** and91 nonempty signer-shard chunks: no transaction matched nonce **221777577000135**. The finalized owner nonce remained **221777577000134**; finalized secret metadata stayed unchanged.

**These absences are not proof of never-dispatch.** Per the reviewed lost-response runbook, the original remains **UNKNOWN**. The updater was not rerun, no alternative native send was fabricated, and the registry batches were not advanced. Original-hash recovery needs operator review; do not create a new journal to evade this unresolved original.

## Final production state

At held finalized block223985249, both `/api/keyhole` and `/api/worker` still return **503 + no-store**. All22 registry versions and old active `d337e822…9ae41` remain unchanged. Full contract raw-state/NFT/control/credit/config preservation still passes; v2.6 code stays live. Lending OFF. Restore and worker promotion are not evaluated/passed; maintenance OFF and production read-flow smoke are not attempted because the required preceding gate remains unresolved.

The requested auxiliary strict-judge rerun really used **dRPC**. Exact code/hash/minter checks passed, then its unchanged Python urllib phase again returned **HTTP403**. Full strict judge result is **FAIL/incomplete**, never relabelled PASS.

Saved native transactions, reusable approvals/signatures and private operator material remain outside Git. Only sanitized public evidence is committed here.
