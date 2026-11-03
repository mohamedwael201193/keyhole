# Worker publish 09d481a5 (2026-11-03, Cairo UTC+2)

Adds the scoped beat key (`add_beat_key`, `del_beat_key`, PR #72) and sets `chain_sign` to 15 Tgas (v1.signer requires 10, burns about 7).

| Step | Proof |
|---|---|
| FastFS upload (expected prepaid-gas revert) | [CFm3suTw…](https://nearblocks.io/txns/CFm3suTwXmvtcEKvjUaBekepaxGu2buu9mRUa9qMr85s) |
| `add_version`, set active | [F1XzcCcz…](https://nearblocks.io/txns/F1XzcCczrnkGryZ4UuvmGQA1gFeW6U26KJEu9mne6ZQu) |
| Live `info` call, attestation 1253394 | [2896d0ad](https://api.outlayer.ai/attestations/by-call/2896d0ad-aa27-4e21-b4a1-0cf2d3755d56) |
| `./verify.sh 2896d0ad… --rebuild` | [verify-rebuild.txt](verify-rebuild.txt): local build = executed = FastFS = DEPLOYED_SHA256 |

Build 705,474 bytes. Cost 0.008438 NEAR from keyhole-devmo.near (2.726161 → 2.717723).

## Chain Signatures: one real MPC signature
- Holder of key `k5f4750858f328940` signed a `chain_sign` request for hash `0x718565f6…fa7a` (sha3-256 of `keyhole chain signature demo 2026-11-03`).
- Enclave call [0cd1c3bd](https://api.outlayer.ai/attestations/by-call/0cd1c3bd-21be-44dc-bc60-e792a42344e6); the minter's `v1.signer.sign` tx [7P9VFx4p…](https://nearblocks.io/txns/7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQcEM2vgKFUAfK).
- Signature `e5bc44dc…898e01` (r‖s‖v). The enclave checked it recovers to the key's derived address before answering; an independent check with viem `recoverAddress` also gives `0xe39C947d5AAC2F9560b690E6f9a8B5d349f4f063`, the address `chain_address` returns ([3d81f582](https://api.outlayer.ai/attestations/by-call/3d81f582-0548-46ed-8491-eb95a9ffa924)) and `web/lib/chainsig.ts` derives in the browser.
- Nothing was broadcast on any other chain. Full output: [chain_sign_0cd1c3bd.json](chain_sign_0cd1c3bd.json).

## Scoped beat key
- Owner-signed `add_beat_key`, enclave call [2597df48](https://api.outlayer.ai/attestations/by-call/2597df48-ed46-4f12-9cf3-c77b4433271e), AddKey tx [DXH756vm…](https://nearblocks.io/txns/DXH756vmgj8GTDz6fUwnfgaUuC7vCi1vu6VaX5heoDww).
- On chain (`view_access_key`, minter `015a0259…c443`, key `ed25519:9FiNXX2M…6LXR`): `FunctionCall`, receiver `keyhole-devmo.near`, methods `["beat"]`, allowance 0.05 NEAR (0.04982 after one beat).
- Real beat signed with that key: [B1BH9eZy…](https://nearblocks.io/txns/B1BH9eZycbXqgwod2dqbn6e5UWY8TKTw2ZawyYqLRDtG), event `nft_metadata_update` for `k5f4750858f328940`.
- The same key, rejected by NEAR before execution (nothing included on chain):

| Attempt | NEAR's answer |
|---|---|
| `nft_transfer` with 1 yocto | `DepositWithFunctionCall` |
| `set_minter` (another method) | `MethodNameMismatch` |
| Send 1 yocto NEAR | `RequiresFullAccess` |
