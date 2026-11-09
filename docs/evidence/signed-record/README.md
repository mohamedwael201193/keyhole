# Signed record for a listed key, on build d337e822 (2026-11-09)

Test wallets only. The holder is the team test wallet `3bde8ce5…8447`. The key is `k5f4750858f328940`. The contract is `keyhole-devmo.near`, contract v2.4.

The public `record` op lets anyone ask the worker for a statement about a listed key. The statement is signed by the minter, so a third party can check it without trusting the site. The statement covers the key's tier and its settled history, and it names the token's owner. The site's Sale card checks it in the browser.

## Steps

| Step | Id | Link | Result |
|---|---|---|---|
| Test holder lists the key at 50 NEAR | tx `J2pMXQhLK7dZJKME126oK3AaeEg2U8kvXDqA1jVE3UuG` | [nearblocks](https://nearblocks.io/txns/J2pMXQhLK7dZJKME126oK3AaeEg2U8kvXDqA1jVE3UuG) | success, signer `3bde8ce5…8447`, method `nft_list` |
| Public `record` call for the listed key | [`b5fbed71-d497-43fe-bbd4-6e28efc4dacf`](https://api.outlayer.ai/attestations/by-call/b5fbed71-d497-43fe-bbd4-6e28efc4dacf) (attested, [file](attestation_b5fbed71.json)) | attestation API | `keyhole-record-v1` statement signed by the minter: tier 2, 10 settled swaps, volume 5,609,200 usd micro |
| Sale card in the browser: 7 of 7 checks | — | keyhole-seven.vercel.app, Sale card on the listing | statement, ed25519 signature, minter, token, owner on chain, seller, age |
| Unlist | tx `6Qp2F32qfBxAhJh5w1HPtmgvTiTba5k8nsfznNYfYckU` | [nearblocks](https://nearblocks.io/txns/6Qp2F32qfBxAhJh5w1HPtmgvTiTba5k8nsfznNYfYckU) | success, signer `3bde8ce5…8447`, method `nft_unlist` |

The `record` call was attested on `d337e822` (`executed_wasm_sha256` = `wasm_hash`, TDX quote present). Its output hash is `0cbed6d4…3a09`. The statement body is not stored in this folder; the attestation holds only the hash.

## Build and info call

- Worker `d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41` (765,658 bytes). This is the historical release identity; current Linux source-build scope and measured outputs are documented in [SECURITY.md](../../../SECURITY.md#source-build-verification-scope). The add_version tx [`BWQxEoSg…`](https://nearblocks.io/txns/BWQxEoSg3b6XHdk4iooAneoBJM7EtP83HTrvYXpdBQi5) is success, signer `keyhole-devmo.near`, receiver `outlayer.near`, method `add_version`.
- Info call on this build: [`dc3668db-674f-4865-a2ce-272f70c41b0d`](https://api.outlayer.ai/attestations/by-call/dc3668db-674f-4865-a2ce-272f70c41b0d) (attested, [file](attestation_dc3668db.json)). Its output is in [`web/public/evidence/dc3668db-674f-4865-a2ce-272f70c41b0d.json`](../../../web/public/evidence/dc3668db-674f-4865-a2ce-272f70c41b0d.json). The canonical sha256 of that output equals the attested `output_hash` `f1279fd0…61e8`. It lists 25 ops, including `record`.
- First signed call on this build: `balance`, [`740191ec-48a4-4bbb-87f9-906b27c8116e`](https://api.outlayer.ai/attestations/by-call/740191ec-48a4-4bbb-87f9-906b27c8116e) (attested, [file](attestation_740191ec.json)), result ok.

## Site swap on an unlocked session (no wallet popup)

Key `0` (the contract account's test key) vault was funded by tx [`EURp4e8V…`](https://nearblocks.io/txns/EURp4e8VTPVeSBjhyTUaCH3tZLp8it2Ev9ycUvLxcjUE) (signer `keyhole-devmo.near`, receiver `wrap.near`, success). The site then swapped 0.05 wNEAR to 0.179929 USDC on an unlocked session, with no wallet popup. The call is [`9f76716e-b3d6-4081-b50f-fdff21a60f82`](https://api.outlayer.ai/attestations/by-call/9f76716e-b3d6-4081-b50f-fdff21a60f82) (attested, [file](attestation_9f76716e.json)).

This swap ran on the previous build `cc8d2fa8` (`executed_wasm_sha256` = `cc8d2fa8…ec4c`), not on `d337e822`. It is included as a session test, not as a record on the current build.

## What this shows and what it does not

- The statement is signed by the minter. A third party can check the signature, the token, the owner on chain and the age, and the browser does so.
- The statement is what the enclave read on that call. It does not prove that the trade log is complete. The minter's signature is the trust point.
- The records are from test wallets. They are not independent users.
