# Numbers

## 9. Numbers

Current V2 source-candidate validation: [exact source/artifact/count record](../docs/evidence/worker-provisioning/v2/r3/validation.json) and [Round 3 correction proof](../docs/evidence/worker-provisioning/v2/r3/README.md), with the [CI reproduction recipe](../docs/evidence/worker-provisioning/v2/CI_REPRODUCTION.md). [R4](../docs/evidence/worker-provisioning/R4.md) and [R2](../docs/evidence/worker-provisioning/R2.md) remain historical. Mainnet and product measurements below retain their explicitly named historical evidence.

| Component | Count | How it was measured |
|---|---|---|
| Keys contract unit tests | **342** pass | `cd contracts/keys && cargo test --locked` (current local measurement) |
| Keys contract sandbox tests | **62** pass, 1 opt-in ignored | full local suite: 28 Pledge/CAS candidate cases plus 34 upgrade/sale/runtime cases |
| TEE worker unit tests | **758** pass | `cd tee/worker && cargo test --locked` (lib and main test binaries, summed) |
| CLI tests | **81** pass | `cd cli && npm test`; [candidate log](../docs/evidence/worker-provisioning/v2/r3/cli-tests.log) |
| Web unit tests (Vitest) | **2032** pass in 124 files | `cd web && npx vitest run`; [candidate log](../docs/evidence/worker-provisioning/v2/r3/web-tests.log) |
| Web e2e (Playwright) | **221** pass, 15 opt-in skipped | [`web/e2e/site.spec.ts`](../web/e2e/site.spec.ts) and the rest of [`web/e2e`](../web/e2e). reproduced at 1440 and 390 px; [candidate log](../docs/evidence/worker-provisioning/v2/r3/web-e2e.log) |
| Claims in `docs/claims.json` | **689**: offline 365 PASS, 0 FAIL, 0 ERROR, 324 SKIP (current repair) | `node judge/verify-claims.mjs --offline`; the historical online result does not validate this candidate |
| Attestation calls linked in this README | every one resolves | each call id was requested from `api.outlayer.ai/attestations/by-call/` (HTTP 200) |
| Tokens for swap | feed-derived, not adoption | live `GET www.getkeyhole.xyz/api/tokens`. The count is the feed, not a customer count |
| Keys minted | **6** on the contract: 5 keys held by people and token `0`, a test key held by `keyhole-devmo.near` | live RPC `nft_total_supply` (historical). The home page counts the five holder keys |
| Settled 1Click orders read live | **2**: one SUCCESS (0.367068 USDC), one REFUNDED (`NO_LIQUIDITY`) | [`oneclick-sol`](../docs/evidence/oneclick-sol/README.md) |
| Mainnet E2E | **30** recorded steps: 24 TEE calls, each attested and re-verified, plus 6 MCP steps | [the 30-step table below](#e2e-table) |
| Website performance | Mobile performance 98–100, mobile LCP 1.5–2.3 s. Desktop 100 on every page. Accessibility, best practices and SEO 100 on every page. Lighthouse 12.8.2, fetched historical | [`docs/evidence/lighthouse.json`](../docs/evidence/lighthouse.json) |

The pinned source commit is `identity.json` `review.source_commit`. A commit count is not a measure of the product. CI runs the six jobs in [§7](../README.md#tests-and-ci).

### Keys on the contract

Six tokens exist (`nft_total_supply` = 6, read historical). Five are tier 1. `k5f4750858f328940` is tier 2 after `level_up` (historical) and is held by the buyer of the historical sale. All six are held by the accounts below. Token `0` is a test key held by the contract account. The four tokens minted before the build that writes `media` (`0`, `k0642e7964b2fb515`, `k5f4750858f328940`, `k857b6b68facc0f94`) have `media: null` on chain; the site draws their art from `sha256(contract id + token id)`. Newer mints write `media` and its hash into the token.

| token | holder | tier | mint tx |
|---|---|---|---|
| `0` (test key) | `keyhole-devmo.near` | 1 | [`UYHismxe…`](https://nearblocks.io/txns/UYHismxe3a2Xb5YvbVHuGhsHWf7ERrx5oCrxREePBFR) |
| `k857b6b68facc0f94` | [`a7458a83…91da`](https://nearblocks.io/address/a7458a83e9c4693286692efab949fc0f7d089b7f46352fb2a87a514ec2c391da) | 1 | [`FaYzSUYT…`](https://nearblocks.io/txns/FaYzSUYTzoG3udAE3d31sUwWFeskndkhrZ8iehk1NxJ4) (signed by the first TEE minter) |
| `k5f4750858f328940` | [`3bde8ce5…8447`](https://nearblocks.io/address/3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447) (bought from `0705fdc1…8228` in the historical run, see [the earned-tier and sale run](../docs/evidence/earned-tier-and-sale/README.md); before that, `0705fdc1…8228` had bought it from `3bde8ce5…8447` in the historical run, see [the transfer run](../docs/evidence/transfer-a985fd87/README.md)) | 2 | [`DJxbuaJV…`](https://nearblocks.io/txns/DJxbuaJVAhwBrK9xne1t623XuL8dMSm8So3eEVtZpHgF) (signed in-enclave by the current minter) |
| `k0642e7964b2fb515` | [`476abdb5…8c8`](https://nearblocks.io/address/476abdb54d0a55fba7cf45c624aa5a65665aaa92f50f4dd36f09abc1890ca8c8) | 1 | minted through the enclave, call [`9e62569d`](https://api.outlayer.ai/attestations/by-call/9e62569d-9444-4503-8bf2-4c1c266b8316) |
| `k102a806df6867547` | [`0xf76e6b09…71a3`](https://nearblocks.io/address/0xf76e6b0920e9332ff4410f6dd53f01722abc71a3) (MetaMask, EIP-191) | 1 | minted through the enclave from a MetaMask account; carries `media` on-chain |
| `k22b07f20ff167d8d` | `a838e946…92f4` (read over RPC) | 1 | not in the earlier table; `media` is set on chain |

<a id="e2e-table"></a>

<details>
<summary><b>The 30-step mainnet E2E table</b> (build <code>f13efe92</code>, historical run with the CLI and MCP against a named wallet)</summary>

All 24 TEE calls were re-verified: the attestation is present, `executed_wasm_sha256 == f13efe926132…`, and `output_hash` matches the published output ([`VERIFY.json`](../docs/evidence/mainnet-e2e/VERIFY.json)). Funds that went in were withdrawn back to the owner, and the final balance is empty (step 30).

| # | Step | Result | TEE call (attestation) | Evidence |
|---|---|---|---|---|
| 1 | `info`: worker version, limits, TEE minter | ok | [`cefbc64e`](https://api.outlayer.ai/attestations/by-call/cefbc64e-6c08-4bfe-a165-1667d9f5f25b) ✓ | [01_info.json](../docs/evidence/mainnet-e2e/01_info.json) |
| 2 | `status`: signed read of tier, caps, spend | ok | [`c96f3729`](https://api.outlayer.ai/attestations/by-call/c96f3729-c266-4fec-a0df-73770915ab7a) ✓ | [02_status.json](../docs/evidence/mainnet-e2e/02_status.json) |
| 3 | `quote` dry, confidentiality basic | ok | [`a62c9d76`](https://api.outlayer.ai/attestations/by-call/a62c9d76-81b2-47e8-865d-c2d1714d507e) ✓ | [03_quote_dry.json](../docs/evidence/mainnet-e2e/03_quote_dry.json) |
| 4 | `quote` execute, real deposit address, no funds sent | ok | [`a1bf58e8`](https://api.outlayer.ai/attestations/by-call/a1bf58e8-d3ba-4a77-ae86-9e31fe5b8523) ✓ | [04_quote_execute_deposit_address.json](../docs/evidence/mainnet-e2e/04_quote_execute_deposit_address.json) |
| 5 | `quote` confidentiality advanced | ok | [`44c12951`](https://api.outlayer.ai/attestations/by-call/44c12951-5cda-48b1-beba-0632e70dc98d) ✓ | [05_quote_advanced.json](../docs/evidence/mainnet-e2e/05_quote_advanced.json) |
| 6 | `account` and a cross-chain deposit address on Base | ok | [`a523a6ea`](https://api.outlayer.ai/attestations/by-call/a523a6ea-56ca-466d-99c3-7f7d4dccd3ad) ✓ | [06_account_crosschain_deposit_address_base.json](../docs/evidence/mainnet-e2e/06_account_crosschain_deposit_address_base.json) |
| 7 | `balance` before trading | ok | [`9374b0ac`](https://api.outlayer.ai/attestations/by-call/9374b0ac-dcdf-4416-b162-2ebc8c13483d) ✓ | [07_balance_before.json](../docs/evidence/mainnet-e2e/07_balance_before.json) |
| 8 | `swap` 0.005 USDC → wNEAR inside the confidential account | ok, intent `Xr4TM3tE…` | [`09d58c09`](https://api.outlayer.ai/attestations/by-call/09d58c09-c1e9-48b6-bebb-485f5ae79539) ✓ | [08_swap_0.005_usdc.json](../docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json) |
| 9 | MCP `tools/list` | ok (local MCP step) | none | [09_mcp_tools_list.json](../docs/evidence/mainnet-e2e/09_mcp_tools_list.json) |
| 10 | MCP `copy` step 1: preview and one-time confirm code | ok (local MCP step) | none | [10_mcp_copy_preview.json](../docs/evidence/mainnet-e2e/10_mcp_copy_preview.json) |
| 11 | MCP `copy` with a wrong confirm code | refused: invalid confirm code | none | [11_mcp_copy_bad_code.json](../docs/evidence/mainnet-e2e/11_mcp_copy_bad_code.json) |
| 12 | MCP `copy` step 2: confirmed trade | ok, intent `Gagspu7r…`, request `6ef53a84` | MCP output (no call id in the file) | [12_mcp_copy_confirmed.json](../docs/evidence/mainnet-e2e/12_mcp_copy_confirmed.json) |
| 13 | MCP `quote_buy` | ok, policy passed | MCP output | [13_mcp_quote_buy.json](../docs/evidence/mainnet-e2e/13_mcp_quote_buy.json) |
| 14 | MCP `explain_pnl` | ok (local MCP step) | none | [14_mcp_explain_pnl.json](../docs/evidence/mainnet-e2e/14_mcp_explain_pnl.json) |
| 15 | `swap` 2 USDC, over the $1 Bronze cap | refused `over_cap_per_tx` | [`a02613a2`](https://api.outlayer.ai/attestations/by-call/a02613a2-d503-45e2-83b8-ef71927c2533) ✓ | [15_overcap_swap_2usdc.json](../docs/evidence/mainnet-e2e/15_overcap_swap_2usdc.json) |
| 16 | signed request, first use | ok | [`85582544`](https://api.outlayer.ai/attestations/by-call/85582544-8e08-4c9f-b3f0-ecad128201ab) ✓ | [16_replay_first.json](../docs/evidence/mainnet-e2e/16_replay_first.json) |
| 17 | the same signed request again | refused `replay` | [`ac289f04`](https://api.outlayer.ai/attestations/by-call/ac289f04-0df8-4161-9123-e872ab3b75ab) ✓ | [17_replay_second_refused.json](../docs/evidence/mainnet-e2e/17_replay_second_refused.json) |
| 18 | signature made for another recipient | refused `wrong_recipient` | [`b9c8cb4f`](https://api.outlayer.ai/attestations/by-call/b9c8cb4f-e3aa-480f-bb47-70fc30a96d67) ✓ | [18_wrong_recipient_refused.json](../docs/evidence/mainnet-e2e/18_wrong_recipient_refused.json) |
| 19 | tampered message | refused `bad_signature` | [`942b4cff`](https://api.outlayer.ai/attestations/by-call/942b4cff-23c9-4e4d-8ebc-79bfa01cd029) ✓ | [19_tampered_refused.json](../docs/evidence/mainnet-e2e/19_tampered_refused.json) |
| 20 | signed op differs from the requested op | refused `op_mismatch` | [`7a703e8f`](https://api.outlayer.ai/attestations/by-call/7a703e8f-2678-4978-b6ce-4d291828141d) ✓ | [20_op_mismatch_refused.json](../docs/evidence/mainnet-e2e/20_op_mismatch_refused.json) |
| 21 | signature older than 5 minutes | refused `expired` | [`e7ac0627`](https://api.outlayer.ai/attestations/by-call/e7ac0627-be6d-41e9-95d0-71dcc59aed43) ✓ | [21_stale_refused.json](../docs/evidence/mainnet-e2e/21_stale_refused.json) |
| 22 | no signature | refused `no_auth` | [`750defed`](https://api.outlayer.ai/attestations/by-call/750defed-2267-45b1-8a8c-74b528aa30ee) ✓ | [22_no_auth_refused.json](../docs/evidence/mainnet-e2e/22_no_auth_refused.json) |
| 23 | second mint by the same holder | refused `already_holder` | [`a516a457`](https://api.outlayer.ai/attestations/by-call/a516a457-0be8-4805-acb1-4f3a9ad30ad3) ✓ | [23_mint_again_refused.json](../docs/evidence/mainnet-e2e/23_mint_again_refused.json) |
| 24 | `history`, the private trade log | ok | [`f0cf9778`](https://api.outlayer.ai/attestations/by-call/f0cf9778-1874-4c0b-b1a5-091218f9fcc6) ✓ | [24_history.json](../docs/evidence/mainnet-e2e/24_history.json) |
| 25 | `balance`, again within the same minute | refused `rate_limited` | [`d892ac43`](https://api.outlayer.ai/attestations/by-call/d892ac43-b786-4d5b-909a-764b6c92f6fd) ✓ | [25_balance_after_trades.json](../docs/evidence/mainnet-e2e/25_balance_after_trades.json) |
| 26 | `balance`, again within the same minute | refused `rate_limited` | [`1a88f79f`](https://api.outlayer.ai/attestations/by-call/1a88f79f-49dd-45fb-bcae-96b746f38423) ✓ | [26_balance_final.json](../docs/evidence/mainnet-e2e/26_balance_final.json) |
| 27 | `balance` after the window | ok | [`6b992a3c`](https://api.outlayer.ai/attestations/by-call/6b992a3c-5909-4a75-a694-dd08918e33da) ✓ | [27_balance.json](../docs/evidence/mainnet-e2e/27_balance.json) |
| 28 | `withdraw` wNEAR → native NEAR to `keyhole-devmo.near`, request `633af674` | ok | [`afc0f232`](https://api.outlayer.ai/attestations/by-call/afc0f232-7d93-4a0e-8768-f62f245c537e) ✓ | [28_withdraw_wnear.json](../docs/evidence/mainnet-e2e/28_withdraw_wnear.json) |
| 29 | `withdraw` USDC to `keyhole-devmo.near`, request `4330a163` | ok | [`a39fffd9`](https://api.outlayer.ai/attestations/by-call/a39fffd9-201b-4af2-927f-94a90d54cbf5) ✓ | [29_withdraw_usdc.json](../docs/evidence/mainnet-e2e/29_withdraw_usdc.json) |
| 30 | `balance` final: empty, funds recovered | ok | [`3ef04098`](https://api.outlayer.ai/attestations/by-call/3ef04098-f287-4527-a8f2-52511beaa9e3) ✓ | [30_balance_final.json](../docs/evidence/mainnet-e2e/30_balance_final.json) |

</details>
