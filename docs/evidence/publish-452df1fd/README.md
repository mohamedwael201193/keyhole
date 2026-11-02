# Worker publish 452df1fd (2026-11-02, Cairo UTC+2)

Adds the security review fixes R1 to R4 ([review](../red-review/README.md)).

| Step | Proof |
|---|---|
| FastFS upload (expected prepaid-gas revert) | [AUyw7Kjq…](https://nearblocks.io/txns/AUyw7KjqweNGSMD7ChYh7MJGMthQXTJhFqQzfEMZzZ3c) |
| `add_version`, set active | [FXbXhGNi…](https://nearblocks.io/txns/FXbXhGNirZCkiP2bx1aiBFQL3Q1EHFMpniJTY579oGWN) |
| Live `info` call, attestation 1246133 | [7882f97a](https://api.outlayer.ai/attestations/by-call/7882f97a-06e5-46d3-9e58-5fe6428fb187) |
| `./verify.sh 7882f97a… --rebuild` | [verify-rebuild.txt](verify-rebuild.txt): all OK, local build = executed = FastFS = DEPLOYED_SHA256 |

Cost: 0.008317 NEAR from keyhole-devmo.near (balance 0.740037 → 0.731720).
TEE minter `015a0259…c443` held 0.0526 NEAR after the publish; a mint needs 0.034 NEAR available (0.012 deposit + 0.022 fee buffer) and leaves most of it, so at least 2 mints are covered.
