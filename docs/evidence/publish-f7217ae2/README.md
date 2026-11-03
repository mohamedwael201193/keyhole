# Worker publish f7217ae2 (2026-11-03, Cairo UTC+2)

Adds Chain Signatures per key NFT: `chain_address` (public; derived locally and cross-checked against `v1.signer.derived_public_key`) and `chain_sign` (holder-signed; the TEE minter calls `v1.signer.sign` and the answer must recover to the key's derived address). Source: PR #67.

| Step | Proof |
|---|---|
| FastFS upload (expected prepaid-gas revert) | [GaK1ham7…](https://nearblocks.io/txns/GaK1ham7MwpPYrRVJHCh3PuaNyfSgMF5U3WKdPWqTLiW) |
| `add_version`, set active | [CcttLJdw…](https://nearblocks.io/txns/CcttLJdwCa8EaLhY42fh6SBZbcVphtycrNTc74jnvkyW) |
| Live `info` call, attestation 1252377 | [54207d9e](https://api.outlayer.ai/attestations/by-call/54207d9e-b4f0-438b-9a74-cdba33de80d9) |
| Live `chain_address` for key `k5f4750858f328940` → `0xe39C947d5AAC2F9560b690E6f9a8B5d349f4f063` | [3d81f582](https://api.outlayer.ai/attestations/by-call/3d81f582-0548-46ed-8491-eb95a9ffa924) |
| `./verify.sh 54207d9e… --rebuild` | [verify-rebuild.txt](verify-rebuild.txt): local build = executed = FastFS = DEPLOYED_SHA256 |

Build: 699,469 bytes. Cost: 0.008408 NEAR from keyhole-devmo.near (2.734570 → 2.726161).

First live `chain_sign` attempt ([03df81aa](https://api.outlayer.ai/attestations/by-call/03df81aa-ad71-4a14-a9d6-ace40b77ce3a)) was refused before broadcast by NEAR RPC with `NotEnoughBalance`: the TEE minter holds 0.0526 NEAR and a 100 Tgas call reserves 0.1009 NEAR up front (most of it is refunded after execution). Nothing was spent.
