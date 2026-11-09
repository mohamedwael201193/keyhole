# README command transcript

Recorded on 10 November 2026 (Africa/Cairo, UTC+2), from the isolated README worktree based on main `6317844090d79f892ae4856a0619df8c043b1793`. Node.js `v20.19.2`, Linux, Bash without profile/rc files. The acceptance runner supplies only `HOME`, `PATH` and `LANG=C.UTF-8`; it does not inherit project credentials. No wallet or project keys were supplied.

These are actual executions, not an assurance about future network availability. The runner extracts and executes the exact marked Bash fences in the root README. Dynamic call IDs, supply and holder are observations at execution.

## Exact README command blocks

| Block / log | Actual result |
|---|---|
| [Quick: identity, public verifier, claim ledger](quick.txt) | **541 PASS, 0 FAIL, 0 ERROR, 0 SKIP**; complete block **61.6 seconds** |
| [Offline](offline.txt) | **204 PASS, 0 FAIL, 0 ERROR, 337 SKIP**; 18 verifier tests passed; 0.6 seconds |
| [Regenerate and check](generate.txt) | Generated **541** claims; **204 PASS, 0 FAIL, 0 ERROR, 337 SKIP** offline; 0.2 seconds |
| [Proof mutation + README parser tests](verifier-tests.txt) | **23 tests passed**, 0 failed |
| [Web unit suite](web-tests.txt) | **1508 tests passed**, 77 files |

The public quick path observed contract `DEXHHyEMdFTdFQ32dYnj264RSj3QG2FSwCY5fbjzSiZZ`, version `2.4.0`, supply `6`, two contract FullAccess keys and one scoped FunctionCall key. Published worker bytes: **765658**, SHA256 `d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41`. Fresh public provenance call: [`1e426121-ec64-42a5-b3cb-aa18d2486fe0`](https://api.outlayer.ai/attestations/by-call/1e426121-ec64-42a5-b3cb-aa18d2486fe0). Its 32 events include 10 swaps; the signed head and current contract minter matched.

The run re-fetched **11 historical refusal attestations**, checked exact canonical output commitments and printed each original build. Fresh unauthenticated gateway probes returned **400 bad_op** and **413 oversized body**. These are new gateway checks, not fresh enclave attacks. `/verify`, `/attack` and `/judge` returned HTTP 200. No value-moving operations were invoked.

## Recorded public swap-log input

[public-log.json](public-log.json) is an unmodified public `provenance` response. Its 32 events contain 10 swaps. The Ed25519-signed head is `8ca259c26bca49f078547e6b2a82e9c411853d53b5b74a0e2fefc74520317ff0`; the signer is `015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443`. The quick path fetches a new public response and checks that signer against mainnet `config` rather than trusting this fixture's label. Editing an event fails verification.

## Source rebuild experiments

Artifact hash matching and source compilation are different checks. The following experimental rebuilds were run separately from the guaranteed quick path. Their exact outputs are retained, including the failed equivalence check:

| Source | Actual Linux SHA256 | Transcript |
|---|---|---|
| main checkout | `49f9e0a13f4deba449a4295ecb2232f8bda7813bb65835597a462b0edebef531` | [verify.sh --rebuild](source-rebuild-main.txt) |
| committed source archive | `49f9e0a13f4deba449a4295ecb2232f8bda7813bb65835597a462b0edebef531` | [Archive build](source-rebuild-archive.txt) |
| publication commit `0b2df07d70140c6305b7df3907460ad0dbf21dce` | `64816c13d811b3e20553214f69d372f1170355b1e391bf89dd3fa209e2a306fc` | [Publication-source build](source-rebuild-publication-commit.txt) |

Interpretation and authority boundaries: [SECURITY.md](../../../SECURITY.md#source-build-verification-scope). No deployment or binary patch was performed.
