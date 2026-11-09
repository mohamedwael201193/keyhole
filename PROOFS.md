# Proof reference

This is the detailed evidence index behind [README.md](README.md). Current release identities come from [identity.json](identity.json). Historical runs retain their original build, amounts and wallets; reading them again does not perform the action again. Explicit clock times below are converted to Africa/Cairo (UTC+2); source artifacts retain their original timestamps. Date-only capture labels are retained from the historical artifacts.

## Mainnet behavior evidence

Every row is a mainnet transaction or a TEE call. Explicit times are Africa/Cairo (UTC+2). `—` means the evidence file does not record a date. The second table retains the earlier runs.

| # | What happened | Date | Proof |
|---|---|---|---|
| 1 | **Keys contract v2.4 deployed**, code only: `nft_set_tier` for earned tiers and a built-in key sale. Code hash `DEXHHyEM…` | 2026-11-09 01:43:53 Africa/Cairo | tx [`84zVBikU…`](https://nearblocks.io/txns/84zVBikU5JrAAnyaXTHQWwQSuq15zgLmMFJZsVnJZsPn) · [evidence](docs/evidence/contract-v2-4/README.md) |
| 2 | **Worker `cc8d2fa8` published (now previous)**: earned tiers (`level_up`) and the freeze of a listed key | 2026-11-09 01:46:00 Africa/Cairo | tx [`Epaz3aMA…`](https://nearblocks.io/txns/Epaz3aMAk1WuLGaMuHKCACvGU981uEr4zUqzyep1zfi6) · info call [`0847b924`](https://api.outlayer.ai/attestations/by-call/0847b924-df76-4cee-ab5a-a96c789d2983) lists `level_up` · [evidence](docs/evidence/publish-cc8d2fa8/README.md) |
| 3 | **Mint** signed in the enclave by the current minter (key `k5f4750858f328940`) | — | tx [`DJxbuaJV…`](https://nearblocks.io/txns/DJxbuaJVAhwBrK9xne1t623XuL8dMSm8So3eEVtZpHgF) |
| 4 | **Handover.** A withdraws before the transfer (ok). The key moves A to B in one transfer (tx [`G35r5pmC…`](https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD)). A's withdraw after it is refused `not_owner` | 2026-11-01 | before [`440c2378`](https://keyhole-seven.vercel.app/verify?call=440c2378-6c27-49fd-8b6b-d74054f331ae) ok · after [`e805f050`](https://keyhole-seven.vercel.app/verify?call=e805f050-d416-4a04-9b12-270adbe02068) `not_owner` · [evidence](docs/evidence/ownership-and-limits/README.md) |
| 5 | **Earned tier.** Ten swaps by the seller, then `level_up` raises the key from Bronze (tier 1) to Silver (tier 2) | 2026-11-09 01:54:00 Africa/Cairo to 2026-11-09 02:35:00 Africa/Cairo | tx [`Ff4nibRd…`](https://nearblocks.io/txns/Ff4nibRd3XMdEgRXwGyDteLFXRdXwqEmY6FJqo2PsNvs) · attested [`02a4e30d`](https://api.outlayer.ai/attestations/by-call/02a4e30d-8e75-4587-9507-56a247751fc5) · [steps](docs/evidence/earned-tier-and-sale/README.md) |
| 6 | **In-contract sale.** The seller lists the key (tx [`4kQnM9Fj…`](https://nearblocks.io/txns/4kQnM9FjEKvXXEtenePc7LfdTtyLNbFirx5X8ytnvm1h)). While listed, the seller's withdraw and swap are refused `listed`. The buyer buys (tx [`BbTs3JZa…`](https://nearblocks.io/txns/BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp)). The old owner is refused `not_owner` | same run as 5 | refused `listed` [`61c6f3ad`](https://api.outlayer.ai/attestations/by-call/61c6f3ad-e1fc-495c-8435-27fd3382c3df), [`c791779a`](https://api.outlayer.ai/attestations/by-call/c791779a-7948-4614-abe0-5376916edeb0) · old owner [`eeb03a55`](https://api.outlayer.ai/attestations/by-call/eeb03a55-6df0-4ef3-af5b-3e9df3331f4e) · [steps](docs/evidence/earned-tier-and-sale/README.md) |
| 7 | **Listing from a real Meteor wallet, in the site.** The owner's Meteor wallet lists, then unlists, key `0` (the contract account's test key) | — | `nft_list` tx [`8nVr98N2…`](https://nearblocks.io/txns/8nVr98N2vYeTAaNiMtGWvge9fiAfoDSSBQL1wnSaTCwH) · `nft_unlist` tx [`2v6Nw9Ww…`](https://nearblocks.io/txns/2v6Nw9WwkbGCoG6PCT2wBRh5bfikLNtoQ6PcHGnbnPQ9) · then from the Sale card's own buttons: `nft_list` [`5d1R83qr…`](https://nearblocks.io/txns/5d1R83qr2WZLM5tKRQWiuS9jweH9rbGFPKDF8DrMEDsi) · `nft_unlist` [`EkRuCKRG…`](https://nearblocks.io/txns/EkRuCKRG4TCtrmJEomfDih7vDVw4xegTNP46G98fXa6A) · [steps](docs/evidence/earned-tier-and-sale/README.md#ui-test-from-a-real-meteor-wallet-list-and-unlist-key-0) |
| 8 | **1Click cross-chain, SUCCESS.** 0.004 SOL on Solana became 0.367068 USDC at `keyhole-devmo.near` | 2026-11-02 | Solana [`2GxLCAXc…`](https://solscan.io/tx/2GxLCAXcEjTQ6NraySheBYFuN7XGAZym96Dqtcdypy8LNrH1UEAfg2566gaGQey4q3YyjMKuhE4cN7RdTMQq94Xv) · NEAR [`8BQznSfb…`](https://nearblocks.io/txns/8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh) · [evidence](docs/evidence/oneclick-sol/README.md) |
| 9 | **1Click REFUNDED** (`NO_LIQUIDITY`). A 0.001 SOL order; 0.00089235 SOL returned | 2026-11-02 | Solana [`5qumXJw4…`](https://solscan.io/tx/5qumXJw4bCdfGzSbVP4Vas12JMkxWEuqaPpzWhHKoTYmxpifbowQKuL1hv9WxyMd9TrNe93WrivimTUcEcok7tPy) · [evidence](docs/evidence/oneclick-sol/README.md) |
| 10 | **37 of 37 checks in the browser** on the previous info call [`0847b924`](https://keyhole-seven.vercel.app/verify?call=0847b924-df76-4cee-ab5a-a96c789d2983) (worker `cc8d2fa8`, run in Chrome on 2026-11-09: "The enclave is genuine") | — | [/verify?call=0847b924…](https://keyhole-seven.vercel.app/verify?call=0847b924-df76-4cee-ab5a-a96c789d2983) |
| 11 | **Signed record for a listed key, checked in the browser.** Test holder `3bde8ce5…` listed key `k5f4750858f328940` at 50 NEAR (tx [`J2pMXQhL…`](https://nearblocks.io/txns/J2pMXQhLK7dZJKME126oK3AaeEg2U8kvXDqA1jVE3UuG)). The public `record` call returned a minter-signed `keyhole-record-v1` statement (tier 2, 10 settled swaps, 5,609,200 µUSD). The Sale card checked 7 of 7. Unlisted (tx [`6Qp2F32q…`](https://nearblocks.io/txns/6Qp2F32qfBxAhJh5w1HPtmgvTiTba5k8nsfznNYfYckU)). Build `d337e822` | 2026-11-09 | `record` [`b5fbed71`](https://api.outlayer.ai/attestations/by-call/b5fbed71-d497-43fe-bbd4-6e28efc4dacf) · [evidence](docs/evidence/signed-record/README.md) |
| 12 | **Site swap with no wallet popup** on an unlocked session. Key `0` vault funded (tx [`EURp4e8V…`](https://nearblocks.io/txns/EURp4e8VTPVeSBjhyTUaCH3tZLp8it2Ev9ycUvLxcjUE)). Swap 0.05 wNEAR to 0.179929 USDC on build `cc8d2fa8` | 2026-11-09 | swap call [`9f76716e`](https://api.outlayer.ai/attestations/by-call/9f76716e-b3d6-4081-b50f-fdff21a60f82) |


| What happened | Date | Proof |
|---|---|---|
| **Contract.** v1 deployed and initialised: owner = treasury = `keyhole-devmo.near`, royalty 500 bps | — | tx [`HEgxese5…`](https://nearblocks.io/txns/HEgxese5vwUeAz2ctbwpdNDjfyhLib7xWXpTJLhwhRD7) |
| Key `0` minted, tier 1 (test key, held by `keyhole-devmo.near`) | — | tx [`UYHismxe…`](https://nearblocks.io/txns/UYHismxe3a2Xb5YvbVHuGhsHWf7ERrx5oCrxREePBFR) |
| Upgrade v1 → v2: deploy and `migrate()` in one transaction. code hash `C8pL59r9…` | 2026-11-03 | tx [`142eipKr…`](https://nearblocks.io/txns/142eipKrruYWL69w31bzCbcSakGvum5XzwTasHxsAdAC) ([evidence](docs/evidence/contract-v2/README.md)) |
| Second `migrate()` refused (`already migrated`), as expected | 2026-11-03 | tx [`9kmr1tsb…`](https://nearblocks.io/txns/9kmr1tsbbXwdr3y8VcwmBGW5zE44MCcwsSANa7S8C4LY) |
| Holder-to-holder transfer refused by the contract (`one key per account`), as expected | 2026-11-03 | tx [`H8qJNgox…`](https://nearblocks.io/txns/H8qJNgoxiizcJw63wKjtBZY4DQT8qbRx1XP9ejXSjkSV) |
| Deploy v2.1 (code only). code hash `6uPe67Sg…` | 2026-11-03 | tx [`HahKkkFj…`](https://nearblocks.io/txns/HahKkkFjXQ5xCky8759qNnoEDm8DjizeveS9B6RHNYy1) |
| Deploy v2.2 (code only; closes the one-key race in `nft_transfer_call`). code hash `BfMiMAfg…` | 2026-11-03 | tx [`GgnNQERT…`](https://nearblocks.io/txns/GgnNQERTj8qKp5VRCdXaTPgb6CjNChamnPsed11AsM5k) |
| Royalty sale, 0.01 NEAR: 5% to treasury and 95% to seller through `nft_transfer_payout`, one transfer event (contract v2.1 or later). Approve tx [`68er4S4y…`](https://nearblocks.io/txns/68er4S4ypnp7L7dCjMNPsWkQeYSnpCGHKMTSgyVAH9DM) | 2026-11-03 | tx [`Azn3WUud…`](https://nearblocks.io/txns/Azn3WUudmSn4ip9B9HNVXTGXriavZ4JK5f3Aqp7JPx2m) ([evidence](docs/evidence/contract-v2/README.md)) |
| Deploy v2.3 (code only; approval cap of 10 per token; NEP-330 `2.3.0`). code hash `8YP8Mr2c…`, replaced by v2.4 | 2026-11-07 19:30:12 Africa/Cairo | tx [`CM7JvwdnN2…`](https://nearblocks.io/txns/CM7JvwdnN2oQ4xakmcSoDPDREBbE7ZUCh5FnJargd5bp) ([evidence](docs/evidence/contract-v2-3/README.md)) |
| Deploy v2.4 (code only; `nft_set_tier` for earned tiers; built-in key sale; NEP-330 `2.4.0`). code hash `DEXHHyEM…`, **release identified by identity.json** | 2026-11-09 01:43:53 Africa/Cairo | tx [`84zVBikU…`](https://nearblocks.io/txns/84zVBikU5JrAAnyaXTHQWwQSuq15zgLmMFJZsVnJZsPn) ([evidence](docs/evidence/contract-v2-4/README.md)) |
| Worker `cc8d2fa8` published, now previous (earned tiers `level_up`, freeze of a listed key on sale). Info call [`0847b924`](https://api.outlayer.ai/attestations/by-call/0847b924-df76-4cee-ab5a-a96c789d2983) lists `level_up`; first signed call [`b6787f80`](https://api.outlayer.ai/attestations/by-call/b6787f80-339e-4de3-8f6d-dc46898d6e6d) is `status`, ok | 2026-11-09 01:46:00 Africa/Cairo | tx [`Epaz3aMA…`](https://nearblocks.io/txns/Epaz3aMAk1WuLGaMuHKCACvGU981uEr4zUqzyep1zfi6) ([evidence](docs/evidence/publish-cc8d2fa8/README.md)) |
| Mint signed in the enclave by the first TEE minter (key `k857b6b68facc0f94`) | — | tx [`FaYzSUYT…`](https://nearblocks.io/txns/FaYzSUYTzoG3udAE3d31sUwWFeskndkhrZ8iehk1NxJ4) |
| `set_minter` to the current enclave minter `015a0259…c443` | — | tx [`7QFqM5Gi…`](https://nearblocks.io/txns/7QFqM5GiUgZuWJEpRUKvARn1LKyy91NVWFZmzNQscQDp) |
| Mint signed in the enclave by the current minter (key `k5f4750858f328940`) | — | tx [`DJxbuaJV…`](https://nearblocks.io/txns/DJxbuaJVAhwBrK9xne1t623XuL8dMSm8So3eEVtZpHgF) |
| Mint through the enclave (key `k0642e7964b2fb515`) | — | call [`9e62569d`](https://api.outlayer.ai/attestations/by-call/9e62569d-9444-4503-8bf2-4c1c266b8316) |
| `sweep_minter`: the old enclave minter sent 0.0286 NEAR to the current one, signed in the TEE | — | tx [`5Z7Tktfc…`](https://nearblocks.io/txns/5Z7TktfcgeFrzRnz8NSpFSbTw77R5779d3PRsrEBPbYA) |
| `beat()` emits `nft_metadata_update` (first beat) | — | tx [`2ShJpaoi…`](https://nearblocks.io/txns/2ShJpaoicEm49L9rcsJjXoubuzoF3SvbQFZASUQBi5dq) |
| Scoped beat key added by the enclave on the owner's signed request | — | tx [`DXH756vm…`](https://nearblocks.io/txns/DXH756vmgj8GTDz6fUwnfgaUuC7vCi1vu6VaX5heoDww) |
| A beat with the scoped beat key (the other method, deposit and transfer attempts are refused by NEAR) | 2026-11-03 | tx [`B1BH9eZy…`](https://nearblocks.io/txns/B1BH9eZycbXqgwod2dqbn6e5UWY8TKTw2ZawyYqLRDtG) ([evidence](docs/evidence/publish-09d481a5/README.md#scoped-beat-key)) |
| Chain Signatures: one real MPC signature for the key's EVM address (`v1.signer.sign`) | 2026-11-03 | call [`0cd1c3bd`](https://api.outlayer.ai/attestations/by-call/0cd1c3bd-21be-44dc-bc60-e792a42344e6), tx [`7P9VFx4p…`](https://nearblocks.io/txns/7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQc) ([evidence](docs/evidence/publish-09d481a5/README.md#chain-signatures-one-real-mpc-signature)) |
| **Earned tier, then a sale, build cc8d2fa8** (team test wallets). `level_up` raises the key from tier 1 to 2: tx [`Ff4nibRd…`](https://nearblocks.io/txns/Ff4nibRd3XMdEgRXwGyDteLFXRdXwqEmY6FJqo2PsNvs), attested [`02a4e30d`](https://api.outlayer.ai/attestations/by-call/02a4e30d-8e75-4587-9507-56a247751fc5). The seller lists the key (tx [`4kQnM9Fj…`](https://nearblocks.io/txns/4kQnM9FjEKvXXEtenePc7LfdTtyLNbFirx5X8ytnvm1h)). While it is listed, the seller's withdraw and swap are refused `listed` ([`61c6f3ad`](https://api.outlayer.ai/attestations/by-call/61c6f3ad-e1fc-495c-8435-27fd3382c3df), [`c791779a`](https://api.outlayer.ai/attestations/by-call/c791779a-7948-4614-abe0-5376916edeb0)). The buyer buys (tx [`BbTs3JZa…`](https://nearblocks.io/txns/BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp)). After it, the old owner is refused `not_owner` ([`eeb03a55`](https://api.outlayer.ai/attestations/by-call/eeb03a55-6df0-4ef3-af5b-3e9df3331f4e)), and the buyer's withdraw is refused `cooldown` ([`2a1aed5b`](https://api.outlayer.ai/attestations/by-call/2a1aed5b-d4e2-45d2-8915-14a5e61a8b12)) | 2026-11-09 01:54:00 Africa/Cairo to 2026-11-09 02:35:00 Africa/Cairo | [steps](docs/evidence/earned-tier-and-sale/README.md) |
| **Transfer handover, build a985fd87** (team test wallets). Key `k5f47508…` sold A → B in one `nft_transfer`. Before the sale A reads 2000 USDC base units; after it A is refused `not_owner` (replay also refused) and B reads the same 2000 | 2026-11-07 21:04:00 Africa/Cairo | tx [`89vSYY4t…`](https://nearblocks.io/txns/89vSYY4tbeNPuNuhHB8YmkkAWAcjW5VdniQm3ePHuPYz); A balance refused [`2a52742a`](https://api.outlayer.ai/attestations/by-call/2a52742a-2b4a-432d-b087-888ea52f03ce); A replay refused [`15f93f58`](https://api.outlayer.ai/attestations/by-call/15f93f58-2568-4064-9581-db04c8b2a1aa); B balance ok [`3e996273`](https://api.outlayer.ai/attestations/by-call/3e996273-e4a0-4c26-aa54-6775fba29236); B withdraw refused `cooldown` [`8485f8d4`](https://api.outlayer.ai/attestations/by-call/8485f8d4-c4e1-4ab5-ab9c-a19a0d9d21f7) ([steps](docs/evidence/transfer-a985fd87/README.md)) |
| **Transfer handover, earlier run.** Key moved from A to B: tx [`G35r5pmC…`](https://nearblocks.io/txns/G35r5pmCTffvKMShjPcwTkds1z8SuCHdJr32qGGzYktD). A withdraws before the transfer: ok [`440c2378`](https://keyhole-seven.vercel.app/verify?call=440c2378-6c27-49fd-8b6b-d74054f331ae). A after the transfer: `not_owner` [`e805f050`](https://keyhole-seven.vercel.app/verify?call=e805f050-d416-4a04-9b12-270adbe02068) | 2026-11-01 | [evidence](docs/evidence/ownership-and-limits/README.md) |
| **Transfer cooldown.** B withdraws within 10 minutes of receiving the key: refused `cooldown` | 2026-11-01 | call [`369f522d`](https://keyhole-seven.vercel.app/verify?call=369f522d-4bef-4b17-9071-1de01616eef6) |
| **Seller lock.** B locks the key for sale: ok [`98b27188`](https://api.outlayer.ai/attestations/by-call/98b27188-a28c-4720-8fec-1d1329e0f281). B's withdraw while locked: refused `locked` [`075287b5`](https://api.outlayer.ai/attestations/by-call/075287b5-a100-4fa5-8e96-94a36019c6bc) | 2026-11-01 | [evidence](docs/evidence/ownership-and-limits/README.md) |
| **Holder limits.** A cuts caps to $0.002 / $0.005: applies at once [`38ae4d84`](https://api.outlayer.ai/attestations/by-call/38ae4d84-9058-4e3b-a01d-e0f0a1f35bb4). A raise is stored as pending for 24 hours [`8e142cce`](https://api.outlayer.ai/attestations/by-call/8e142cce-a608-4ed4-ae61-9eed8f7dec12) | 2026-11-01 | [evidence](docs/evidence/ownership-and-limits/README.md) |
| **Mid-payout.** B signs a withdraw of 3000 USDC base units (0.003 USDC), then transfers the key to A while the payout is in flight (tx [`144iK9uj…`](https://nearblocks.io/txns/144iK9ujaowrUdXySfvGDDjobV2Q5YyJsNPK3KL2GYnc)). The payout completes to B, the holder who signed it. B's next request is refused `not_owner` [`e72dc176`](https://keyhole-seven.vercel.app/verify?call=e72dc176-e6fc-4d89-b348-911f5318b81b). A then sees the remaining 2000 units [`f36d9b54`](https://keyhole-seven.vercel.app/verify?call=f36d9b54-417a-4b33-9598-c396ae852d4d). Build `6367401a` | 2026-11-01 | [evidence](docs/evidence/mid-payout/README.md) |
| **Swap** 0.005 USDC → wNEAR inside the confidential account (intent `Xr4TM3tE…`) | 2026-10-27 | call [`09d58c09`](https://api.outlayer.ai/attestations/by-call/09d58c09-c1e9-48b6-bebb-485f5ae79539) ([step 8](docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json)) |
| **Withdraw** wNEAR → native NEAR to `keyhole-devmo.near` | 2026-10-27 | call [`afc0f232`](https://api.outlayer.ai/attestations/by-call/afc0f232-7d93-4a0e-8768-f62f245c537e) ([step 28](docs/evidence/mainnet-e2e/28_withdraw_wnear.json)) |
| **Withdraw** USDC to `keyhole-devmo.near` | 2026-10-27 | call [`a39fffd9`](https://api.outlayer.ai/attestations/by-call/a39fffd9-201b-4af2-927f-94a90d54cbf5) ([step 29](docs/evidence/mainnet-e2e/29_withdraw_usdc.json)) |
| **1Click SUCCESS.** 0.004 SOL on Solana → 0.367068 USDC to `keyhole-devmo.near` | 2026-11-02 | Solana [`2GxLCAXc…`](https://solscan.io/tx/2GxLCAXcEjTQ6NraySheBYFuN7XGAZym96Dqtcdypy8LNrH1UEAfg2566gaGQey4q3YyjMKuhE4cN7RdTMQq94Xv), NEAR [`8BQznSfb…`](https://nearblocks.io/txns/8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh) ([evidence](docs/evidence/oneclick-sol/README.md)) |
| **1Click REFUNDED** (`NO_LIQUIDITY`). 0.001 SOL order, 0.00089235 SOL returned | 2026-11-02 | Solana [`5qumXJw4…`](https://solscan.io/tx/5qumXJw4bCdfGzSbVP4Vas12JMkxWEuqaPpzWhHKoTYmxpifbowQKuL1hv9WxyMd9TrNe93WrivimTUcEcok7tPy) ([evidence](docs/evidence/oneclick-sol/README.md)) |
| **Refusal `over_cap_per_tx`.** 2 USDC swap against the $1 Bronze cap. Nothing sent | — | call [`a02613a2`](https://api.outlayer.ai/attestations/by-call/a02613a2-d503-45e2-83b8-ef71927c2533) |
| **Refusal `replay`.** First use ok [`85582544`](https://api.outlayer.ai/attestations/by-call/85582544-8e08-4c9f-b3f0-ecad128201ab); the same signed request again refused [`ac289f04`](https://api.outlayer.ai/attestations/by-call/ac289f04-0df8-4161-9123-e872ab3b75ab) | — | [steps 16–17](docs/evidence/mainnet-e2e/17_replay_second_refused.json) |
| **Refusals `wrong_recipient`, `bad_signature`, `op_mismatch`, `expired`, `no_auth`.** A signature made for another recipient [`b9c8cb4f`](https://api.outlayer.ai/attestations/by-call/b9c8cb4f-e3aa-480f-bb47-70fc30a96d67); a tampered message [`942b4cff`](https://api.outlayer.ai/attestations/by-call/942b4cff-23c9-4e4d-8ebc-79bfa01cd029); a signed op that differs from the requested op [`7a703e8f`](https://api.outlayer.ai/attestations/by-call/7a703e8f-2678-4978-b6ce-4d291828141d); a signature older than 5 minutes [`e7ac0627`](https://api.outlayer.ai/attestations/by-call/e7ac0627-be6d-41e9-95d0-71dcc59aed43); no signature [`750defed`](https://api.outlayer.ai/attestations/by-call/750defed-2267-45b1-8a8c-74b528aa30ee) | — | [steps 18–22](docs/evidence/mainnet-e2e/18_wrong_recipient_refused.json) |
| **Refusal `already_holder`.** A second mint by the same holder. No quota used | — | call [`a516a457`](https://api.outlayer.ai/attestations/by-call/a516a457-0be8-4805-acb1-4f3a9ad30ad3) ([step 23](docs/evidence/mainnet-e2e/23_mint_again_refused.json)) |
| **Refusal `rate_limited`.** Second and third balance call in the same minute | — | calls [`d892ac43`](https://api.outlayer.ai/attestations/by-call/d892ac43-b786-4d5b-909a-764b6c92f6fd), [`1a88f79f`](https://api.outlayer.ai/attestations/by-call/1a88f79f-49dd-45fb-bcae-96b746f38423) |
| **Prompt-injection log.** An agent that obeys a poisoned note: pay to `attacker.near` refused `bad_params` [`c1312e2d`](https://keyhole-seven.vercel.app/verify?call=c1312e2d-8c20-4b3e-ad5b-22dd3102826d); over-cap refused [`afaaf3e1`](https://keyhole-seven.vercel.app/verify?call=afaaf3e1-32ff-42d8-88da-412a0bb61e11); a cap raise only pending [`06cf2630`](https://keyhole-seven.vercel.app/verify?call=06cf2630-aed4-410a-9e28-f0799efddeda); replay [`d8f5f0ee`](https://keyhole-seven.vercel.app/verify?call=d8f5f0ee-3c0b-44bc-afed-bc24ad190ed0); edited recipient `bad_signature` [`16b09581`](https://keyhole-seven.vercel.app/verify?call=16b09581-9010-4600-b5c5-58af0216cdc8); previous holder `not_owner` [`711795b9`](https://keyhole-seven.vercel.app/verify?call=711795b9-3e77-4a59-98ee-d798cb63ccc2) | 2026-11-01 | [evidence](docs/evidence/prompt-injection/README.md) |
| **Intents Agent API policy.** The Bronze caps written as an agent policy on the demo partner deployment | 2026-11-03 | tx [`biJNTxXc…`](https://nearblocks.io/txns/biJNTxXc9zbQw6nTMJoPM2HeAE9snEf1mSdbsZ1CWEQ) ([evidence](docs/evidence/agent-api/demo_2026-11-03.json)) |
| **Judge live run** with a different account: first use ok [`d3c285ae`](https://api.outlayer.ai/attestations/by-call/d3c285ae-54a2-442f-a9ee-e9d9af02e4c6), replay [`b6d8ce4e`](https://api.outlayer.ai/attestations/by-call/b6d8ce4e-6d46-4b57-a126-ab4ff9e7a563), over-cap [`9b37dfee`](https://api.outlayer.ai/attestations/by-call/9b37dfee-47bf-4482-a445-0623a49d3f11) | — | [judge-live-run.txt](docs/evidence/judge-live-run.txt) |
| **Full 30-step run** on build `f13efe92` (24 TEE calls, each re-verified, plus 6 MCP steps). The table is in [§9](#9-numbers) | 2026-10-27 | [SUMMARY.json](docs/evidence/mainnet-e2e/SUMMARY.json), [VERIFY.json](docs/evidence/mainnet-e2e/VERIFY.json) |

## Gateway integration recordings

The following calls were recorded on the named builds; these are not current gateway execution results.

Gateway calls on mainnet, signed with the website's own [`web/lib/nep413.ts`](web/lib/nep413.ts) on build `3ea56ee6` (the 0.2.0 worker on project `keyhole-probe`, unless the row says otherwise):

| call | result | attestation | evidence |
|---|---|---|---|
| status | ok, tier 1 | [`9c258ced`](https://api.outlayer.ai/attestations/by-call/9c258ced-40c4-4738-8621-794e35f41f5d) | — |
| quote 0.05 USDC → wNEAR | policy passed | [`57d03a3b`](https://api.outlayer.ai/attestations/by-call/57d03a3b-def4-46dc-a66f-6cfd36570572) | [quote.json](docs/evidence/site-gateway/quote.json) |
| quote 2 USDC | refused `over_cap_per_tx` | [`a28106f0`](https://api.outlayer.ai/attestations/by-call/a28106f0-8eff-49e6-8998-57d99d2e9298) | [quote_overcap.json](docs/evidence/site-gateway/quote_overcap.json) |
| same signed request twice | first ok, then `replay` | [`1792da1a`](https://api.outlayer.ai/attestations/by-call/1792da1a-0a36-4df0-84b0-0d28e7a4828c) → [`6eccc374`](https://api.outlayer.ai/attestations/by-call/6eccc374-ed17-4764-810b-f3f56a1ad6bd) | [replay.json](docs/evidence/site-gateway/replay.json) |
| account | confidential id issued | [`e977cb88`](https://api.outlayer.ai/attestations/by-call/e977cb88-0490-47f8-abfd-eb409eb572b4) | [account.json](docs/evidence/site-gateway/account.json) |
| balance | ok | [`22cb472d`](https://api.outlayer.ai/attestations/by-call/22cb472d-a759-4284-a3fd-651b059dc576) | [balance.json](docs/evidence/site-gateway/balance.json) |
| history | ok | [`b4038809`](https://api.outlayer.ai/attestations/by-call/b4038809-2347-43fd-aa28-f829b677e7d1) | [history.json](docs/evidence/site-gateway/history.json) |
| info via `/api/keyhole` on project `keyhole` | `keyhole-worker/0.2.0` | [`f198ce3a`](https://api.outlayer.ai/attestations/by-call/f198ce3a-a3df-4c27-ac26-79ef50003fb1) (build `f13efe92`) | — |

## Release identities

**Contract.** `contracts/keys/release/` holds the wasm for each version. The code hash on chain is base58 of the wasm's sha256. These values were computed from the committed files on 2026-11-09.

| Version | Wasm sha256 (`release/`) | Code hash (base58) | Status |
|---|---|---|---|
| v1 | `d985104e128c598996932a1504cff26093277f4528ef513578af7386a29e817b` (195,389 bytes) | `Fe79rQUHKXnjhuY4NCDYrv3twNKPw7YTmqK3yxjtqxYA` | previous |
| v2 | `a57123002dbc164bfd5684dc2a360d35c5681c4b4ab59172cb6c45b331a73ad2` (207,996 bytes) | `C8pL59r9NorJxcYXnXusZxz2cNaGEgiVbMnZPANivLc1` | previous |
| v2.1 | `57b63c36d782bb4e60c4a25e9cc238093bc909a328617be864ba6327191a30ac` (208,204 bytes) | `6uPe67SgsPuE71E73jp8zsbReQPGhTbW8UmUV5mjwtuh` | previous |
| v2.2 | `9e685c32bf5f57e0fda86f270e96f79723b54499a670306bb8f8bc0a68d5089e` (209,952 bytes) | `BfMiMAfgMzVYHRREaZr4QTfifwzbqR1wjGweH86xMLeZ` | previous |
| v2.3 | `700bd51fc1cd9bfb46b655f2c6c77632f2c6b6c3c53329dd2990ea36eb00e09d` (210,474 bytes) | `8YP8Mr2c8yCxtZU1xtio8K5Lk5YuPC7WPBzuGFS9WwLG` | previous (live 2026-11-07 to 2026-11-08) |
| **v2.4** | `b5c30849079e18a4a6d13037e43f56952ca8a479bbf64848ce20d21b481a1e5c` (241,621 bytes) | **`DEXHHyEMdFTdFQ32dYnj264RSj3QG2FSwCY5fbjzSiZZ`** | **live on `keyhole-devmo.near`** (deploy tx [`84zVBikU…`](https://nearblocks.io/txns/84zVBikU5JrAAnyaXTHQWwQSuq15zgLmMFJZsVnJZsPn), [evidence](docs/evidence/contract-v2-4/README.md)) |

Contract configuration at capture (2026-11-03; `beats` grows with each heartbeat, re-read by `judge/1-contract.sh`):

```json
{"owner":"keyhole-devmo.near","minter":"015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443","treasury":"keyhole-devmo.near","royalty_bps":500,"beats":"2"}
```

`contracts/keys/deployed/keyhole_keys.wasm` is the code on the account. It is v2.4, checked against the on-chain code hash by `judge/1-contract.sh`. The sha256 table is in [`contracts/keys/release/SHA256SUMS`](contracts/keys/release/SHA256SUMS). Build with `cargo near build non-reproducible-wasm` (rustc 1.86 through `rust-toolchain.toml`, cargo-near 0.22.0, near-sdk 5.17.2); CI rebuilds the source and compares it with the newest entry in `release/SHA256SUMS`.

- **Standards.** NEP-171 core and NEP-177 metadata (`KEYHOLE` / `KEY`) come from `near-contract-standards`. NEP-178 approvals come from the same crate, and every transfer clears them. NEP-181 enumeration provides `nft_tokens`, `nft_tokens_for_owner` and `nft_total_supply`. NEP-199 `nft_payout` and `nft_transfer_payout` are written by hand: the royalty cap is `MAX_ROYALTY_BPS = 1000` (10%), the live value is 500, and the payout always adds up to the sale price. NEP-330 reports version `2.4.0` with the repository link.
- **One key per account.** `nft_mint`, `nft_transfer`, `nft_transfer_call` and `nft_transfer_payout` refuse a receiver that already holds a key (`ERR_ONE_KEY`, [`contracts/keys/src/lib.rs:25`](contracts/keys/src/lib.rs)). That refusal is shown on mainnet in [§2](#2-proven-on-near-mainnet). The worker's `already_holder` check runs before the mint transaction, so a refused mint costs no gas.
- **Mint authority.** `nft_mint` asserts `predecessor == minter` ([`lib.rs:151`](contracts/keys/src/lib.rs)). The minter is an implicit account whose secret key was drawn inside the enclave, and the contract authorizes that minter account. See [SECURITY.md](SECURITY.md) for the authority boundary. `token_id` is at most 64 bytes, and storage is measured with any excess refunded.
- **Heartbeat.** `beat(token_ids)`, minter only, batch of at most 50, emits `nft_metadata_update` ([`lib.rs:189`](contracts/keys/src/lib.rs)).
- **Owner controls.** `set_minter` and `set_royalty` require 1 yoctoNEAR, and `set_royalty` is capped at 10%. `init` and `migrate` are private to the contract account. The tier is read from the contract's `holder_tier` on each call (`limits_for_tier`, [`tee/worker/src/lib.rs:285`](tee/worker/src/lib.rs)).

## Worker registrations

KEYHOLE worker d337e822 is the release in identity.json.

**Worker.** The published artifact hashes to `d337e822544d31da644728ba794f444f7f3ef6c54a6ee7442ab22d07e049ae41`; the quick path compares FastFS bytes, `tee/worker/DEPLOYED_SHA256` and fresh provenance attestation. The TDX runtime measurement is distinct from the application Wasm hash. Source-build scope is documented in [SECURITY.md](SECURITY.md#source-build-verification-scope).

The live build is published as project `keyhole-devmo.near/keyhole`. Its `info` call is the one the browser verifier shows by default. Each earlier build was published with the same `add_version` method and has its own FastFS upload. [`identity.json`](identity.json) is the single source for the live build, the contract hashes and the publish transaction. `node scripts/gen-identity.mjs --check` fails CI when generated files drift.

| Build | Role | `add_version` tx | Live `info` call |
|---|---|---|---|
| `d337e822` (765,658 bytes) | **current, live** | [`BWQxEoSg…`](https://nearblocks.io/txns/BWQxEoSg3b6XHdk4iooAneoBJM7EtP83HTrvYXpdBQi5) | [`dc3668db`](https://api.outlayer.ai/attestations/by-call/dc3668db-674f-4865-a2ce-272f70c41b0d) |
| `cc8d2fa8` (755,751 bytes) | previous | [`Epaz3aMA…`](https://nearblocks.io/txns/Epaz3aMAk1WuLGaMuHKCACvGU981uEr4zUqzyep1zfi6) | [`0847b924`](https://api.outlayer.ai/attestations/by-call/0847b924-df76-4cee-ab5a-a96c789d2983) |
| `a985fd87` (745,180 bytes) | previous | [`A1o8882h…`](https://nearblocks.io/txns/A1o8882hpjZmBr56hhDop236MrSFtEnMfNt9nEZwo4sG) | [`246e4a7a`](https://api.outlayer.ai/attestations/by-call/246e4a7a-f138-4459-8548-350dd9960751) |
| `ebeb6a34` | previous, rolled back to `94c355ff` | [`MG7pGVSN…`](https://nearblocks.io/txns/MG7pGVSNjFDz85yqrAA9stN4yyXECYfYLDmCgYE4gyq) | [`5650a6b7`](https://api.outlayer.ai/attestations/by-call/5650a6b7-b7de-410c-b206-e189171bad15) |
| `94c355ff` | previous | [`EA7S1TeV…`](https://nearblocks.io/txns/EA7S1TeVnMF1v5FthV4ffQf9NYXfGJTtzo4ZRp25ZBjy) | [`ecb0d1d6`](https://api.outlayer.ai/attestations/by-call/ecb0d1d6-90e3-4522-852a-578ca50fdeb6) |
| `cff9fd3c` | previous | [`AepKgT8M…`](https://nearblocks.io/txns/AepKgT8M1XhMjWMHMzaJSo3YnBXzG58YYrLVyp8tUW3z) | [`643a012d`](https://api.outlayer.ai/attestations/by-call/643a012d-0389-44d7-9c78-efb5d7835e80) |
| `a55ebb14` | previous | [`GNqXiicF…`](https://nearblocks.io/txns/GNqXiicFgXQpS5LsYiNRffK6Xhp5W7Yi8EZK2XqKvX8X) | [`b0a6eadb`](https://api.outlayer.ai/attestations/by-call/b0a6eadb-cee9-400e-8eca-8b0f4df7bcec) |
| `09d481a5` | previous | [`F1XzcCcz…`](https://nearblocks.io/txns/F1XzcCczrnkGryZ4UuvmGQA1gFeW6U26KJEu9mne6ZQu) | [`2896d0ad`](https://api.outlayer.ai/attestations/by-call/2896d0ad-aa27-4e21-b4a1-0cf2d3755d56) |
| `f7217ae2` | previous | [`CcttLJdw…`](https://nearblocks.io/txns/CcttLJdwCa8EaLhY42fh6SBZbcVphtycrNTc74jnvkyW) | [`54207d9e`](https://api.outlayer.ai/attestations/by-call/54207d9e-b4f0-438b-9a74-cdba33de80d9) |
| `452df1fd` | previous | [`FXbXhGNi…`](https://nearblocks.io/txns/FXbXhGNirZCkiP2bx1aiBFQL3Q1EHFMpniJTY579oGWN) | [`7882f97a`](https://api.outlayer.ai/attestations/by-call/7882f97a-06e5-46d3-9e58-5fe6428fb187) |
| `6367401a` | previous | [`AJWVEN6F…`](https://nearblocks.io/txns/AJWVEN6FfQaE3ZE3V7KDHj1BtzCKTx3iMH3tx8CLYqKx) | [`f4768da8`](https://api.outlayer.ai/attestations/by-call/f4768da8-2e87-4622-8654-d1e67f6cd1f0) |
| `67c5cd77` | previous | [`86tCjm92…`](https://nearblocks.io/txns/86tCjm92yBqKoHt2kz99es1NadZeKf91AfUTx2uaqfmr) | [`0f0bf448`](https://api.outlayer.ai/attestations/by-call/0f0bf448-1b66-4200-b6de-7cf095aead54) |
| `38bd67b9` | previous | [`9pk1mDC1…`](https://nearblocks.io/txns/9pk1mDC1dxzTXE7H7mHLXVVckHMEmRA4VnfxfxAzdb2z) | [`763812bc`](https://api.outlayer.ai/attestations/by-call/763812bc-0012-4528-a45d-66a3ce17cae9) |
| `b3fa1a39` | previous | [`B3x8cU6G…`](https://nearblocks.io/txns/B3x8cU6GH25cPDxNZ56mP4fACRuqXUbopobeJxR11kCU) | [`9d19bceb`](https://api.outlayer.ai/attestations/by-call/9d19bceb-986b-4745-9bf9-91f7dcb62b6e) |
| `f13efe92` | previous (the 30-step E2E build) | [`22KDVU1s…`](https://nearblocks.io/txns/22KDVU1sNKQhjoYbN8h1JqyQbcNxHRNednT6sz4nogxS) | [`cefbc64e`](https://api.outlayer.ai/attestations/by-call/cefbc64e-6c08-4bfe-a165-1667d9f5f25b) |

## Token snapshot

Six tokens exist (`nft_total_supply` = 6, read 2026-11-09). Five are tier 1. `k5f4750858f328940` is tier 2 after `level_up` (2026-11-09) and is held by the buyer of the 2026-11-09 sale. All six are held by the accounts below. Token `0` is a test key held by the contract account. The four tokens minted before the build that writes `media` (`0`, `k0642e7964b2fb515`, `k5f4750858f328940`, `k857b6b68facc0f94`) have `media: null` on-chain; the site draws their art from `sha256(contract id + token id)`. Newer mints write `media` and its hash into the token.

| token | holder | tier | mint tx |
|---|---|---|---|
| `0` (test key) | `keyhole-devmo.near` | 1 | [`UYHismxe…`](https://nearblocks.io/txns/UYHismxe3a2Xb5YvbVHuGhsHWf7ERrx5oCrxREePBFR) |
| `k857b6b68facc0f94` | [`a7458a83…91da`](https://nearblocks.io/address/a7458a83e9c4693286692efab949fc0f7d089b7f46352fb2a87a514ec2c391da) | 1 | [`FaYzSUYT…`](https://nearblocks.io/txns/FaYzSUYTzoG3udAE3d31sUwWFeskndkhrZ8iehk1NxJ4) (signed by the first TEE minter) |
| `k5f4750858f328940` | [`3bde8ce5…8447`](https://nearblocks.io/address/3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447) (bought from `0705fdc1…8228` on 2026-11-09, see [the earned-tier and sale run](docs/evidence/earned-tier-and-sale/README.md); before that, `0705fdc1…8228` had bought it from `3bde8ce5…8447` on 2026-11-07, see [the transfer run](docs/evidence/transfer-a985fd87/README.md)) | 2 | [`DJxbuaJV…`](https://nearblocks.io/txns/DJxbuaJVAhwBrK9xne1t623XuL8dMSm8So3eEVtZpHgF) (signed in-enclave by the current minter) |
| `k0642e7964b2fb515` | [`476abdb5…8c8`](https://nearblocks.io/address/476abdb54d0a55fba7cf45c624aa5a65665aaa92f50f4dd36f09abc1890ca8c8) | 1 | minted through the enclave, call [`9e62569d`](https://api.outlayer.ai/attestations/by-call/9e62569d-9444-4503-8bf2-4c1c266b8316) |
| `k102a806df6867547` | [`0xf76e6b09…71a3`](https://nearblocks.io/address/0xf76e6b0920e9332ff4410f6dd53f01722abc71a3) (MetaMask, EIP-191) | 1 | minted through the enclave from a MetaMask account; carries `media` on-chain |
| `k22b07f20ff167d8d` | `a838e946…92f4` (read over RPC) | 1 | not in the earlier table; `media` is set on chain |

## Recorded end-to-end run

All 24 TEE calls were re-verified: the attestation is present, `executed_wasm_sha256 == f13efe926132…`, and `output_hash` matches the published output ([`VERIFY.json`](docs/evidence/mainnet-e2e/VERIFY.json)). Funds that went in were withdrawn back to the owner, and the final balance is empty (step 30).

| # | Step | Result | TEE call (attestation) | Evidence |
|---|---|---|---|---|
| 1 | `info`: worker version, limits, TEE minter | ok | [`cefbc64e`](https://api.outlayer.ai/attestations/by-call/cefbc64e-6c08-4bfe-a165-1667d9f5f25b) ✓ | [01_info.json](docs/evidence/mainnet-e2e/01_info.json) |
| 2 | `status`: signed read of tier, caps, spend | ok | [`c96f3729`](https://api.outlayer.ai/attestations/by-call/c96f3729-c266-4fec-a0df-73770915ab7a) ✓ | [02_status.json](docs/evidence/mainnet-e2e/02_status.json) |
| 3 | `quote` dry, confidentiality basic | ok | [`a62c9d76`](https://api.outlayer.ai/attestations/by-call/a62c9d76-81b2-47e8-865d-c2d1714d507e) ✓ | [03_quote_dry.json](docs/evidence/mainnet-e2e/03_quote_dry.json) |
| 4 | `quote` execute, real deposit address, no funds sent | ok | [`a1bf58e8`](https://api.outlayer.ai/attestations/by-call/a1bf58e8-d3ba-4a77-ae86-9e31fe5b8523) ✓ | [04_quote_execute_deposit_address.json](docs/evidence/mainnet-e2e/04_quote_execute_deposit_address.json) |
| 5 | `quote` confidentiality advanced | ok | [`44c12951`](https://api.outlayer.ai/attestations/by-call/44c12951-5cda-48b1-beba-0632e70dc98d) ✓ | [05_quote_advanced.json](docs/evidence/mainnet-e2e/05_quote_advanced.json) |
| 6 | `account` and a cross-chain deposit address on Base | ok | [`a523a6ea`](https://api.outlayer.ai/attestations/by-call/a523a6ea-56ca-466d-99c3-7f7d4dccd3ad) ✓ | [06_account_crosschain_deposit_address_base.json](docs/evidence/mainnet-e2e/06_account_crosschain_deposit_address_base.json) |
| 7 | `balance` before trading | ok | [`9374b0ac`](https://api.outlayer.ai/attestations/by-call/9374b0ac-dcdf-4416-b162-2ebc8c13483d) ✓ | [07_balance_before.json](docs/evidence/mainnet-e2e/07_balance_before.json) |
| 8 | `swap` 0.005 USDC → wNEAR inside the confidential account | ok, intent `Xr4TM3tE…` | [`09d58c09`](https://api.outlayer.ai/attestations/by-call/09d58c09-c1e9-48b6-bebb-485f5ae79539) ✓ | [08_swap_0.005_usdc.json](docs/evidence/mainnet-e2e/08_swap_0.005_usdc.json) |
| 9 | MCP `tools/list` | ok (local MCP step) | none | [09_mcp_tools_list.json](docs/evidence/mainnet-e2e/09_mcp_tools_list.json) |
| 10 | MCP `copy` step 1: preview and one-time confirm code | ok (local MCP step) | none | [10_mcp_copy_preview.json](docs/evidence/mainnet-e2e/10_mcp_copy_preview.json) |
| 11 | MCP `copy` with a wrong confirm code | refused: invalid confirm code | none | [11_mcp_copy_bad_code.json](docs/evidence/mainnet-e2e/11_mcp_copy_bad_code.json) |
| 12 | MCP `copy` step 2: confirmed trade | ok, intent `Gagspu7r…`, request `6ef53a84` | MCP output (no call id in the file) | [12_mcp_copy_confirmed.json](docs/evidence/mainnet-e2e/12_mcp_copy_confirmed.json) |
| 13 | MCP `quote_buy` | ok, policy passed | MCP output | [13_mcp_quote_buy.json](docs/evidence/mainnet-e2e/13_mcp_quote_buy.json) |
| 14 | MCP `explain_pnl` | ok (local MCP step) | none | [14_mcp_explain_pnl.json](docs/evidence/mainnet-e2e/14_mcp_explain_pnl.json) |
| 15 | `swap` 2 USDC, over the $1 Bronze cap | refused `over_cap_per_tx` | [`a02613a2`](https://api.outlayer.ai/attestations/by-call/a02613a2-d503-45e2-83b8-ef71927c2533) ✓ | [15_overcap_swap_2usdc.json](docs/evidence/mainnet-e2e/15_overcap_swap_2usdc.json) |
| 16 | signed request, first use | ok | [`85582544`](https://api.outlayer.ai/attestations/by-call/85582544-8e08-4c9f-b3f0-ecad128201ab) ✓ | [16_replay_first.json](docs/evidence/mainnet-e2e/16_replay_first.json) |
| 17 | the same signed request again | refused `replay` | [`ac289f04`](https://api.outlayer.ai/attestations/by-call/ac289f04-0df8-4161-9123-e872ab3b75ab) ✓ | [17_replay_second_refused.json](docs/evidence/mainnet-e2e/17_replay_second_refused.json) |
| 18 | signature made for another recipient | refused `wrong_recipient` | [`b9c8cb4f`](https://api.outlayer.ai/attestations/by-call/b9c8cb4f-e3aa-480f-bb47-70fc30a96d67) ✓ | [18_wrong_recipient_refused.json](docs/evidence/mainnet-e2e/18_wrong_recipient_refused.json) |
| 19 | tampered message | refused `bad_signature` | [`942b4cff`](https://api.outlayer.ai/attestations/by-call/942b4cff-23c9-4e4d-8ebc-79bfa01cd029) ✓ | [19_tampered_refused.json](docs/evidence/mainnet-e2e/19_tampered_refused.json) |
| 20 | signed op differs from the requested op | refused `op_mismatch` | [`7a703e8f`](https://api.outlayer.ai/attestations/by-call/7a703e8f-2678-4978-b6ce-4d291828141d) ✓ | [20_op_mismatch_refused.json](docs/evidence/mainnet-e2e/20_op_mismatch_refused.json) |
| 21 | signature older than 5 minutes | refused `expired` | [`e7ac0627`](https://api.outlayer.ai/attestations/by-call/e7ac0627-be6d-41e9-95d0-71dcc59aed43) ✓ | [21_stale_refused.json](docs/evidence/mainnet-e2e/21_stale_refused.json) |
| 22 | no signature | refused `no_auth` | [`750defed`](https://api.outlayer.ai/attestations/by-call/750defed-2267-45b1-8a8c-74b528aa30ee) ✓ | [22_no_auth_refused.json](docs/evidence/mainnet-e2e/22_no_auth_refused.json) |
| 23 | second mint by the same holder | refused `already_holder` | [`a516a457`](https://api.outlayer.ai/attestations/by-call/a516a457-0be8-4805-acb1-4f3a9ad30ad3) ✓ | [23_mint_again_refused.json](docs/evidence/mainnet-e2e/23_mint_again_refused.json) |
| 24 | `history`, the private trade log | ok | [`f0cf9778`](https://api.outlayer.ai/attestations/by-call/f0cf9778-1874-4c0b-b1a5-091218f9fcc6) ✓ | [24_history.json](docs/evidence/mainnet-e2e/24_history.json) |
| 25 | `balance`, again within the same minute | refused `rate_limited` | [`d892ac43`](https://api.outlayer.ai/attestations/by-call/d892ac43-b786-4d5b-909a-764b6c92f6fd) ✓ | [25_balance_after_trades.json](docs/evidence/mainnet-e2e/25_balance_after_trades.json) |
| 26 | `balance`, again within the same minute | refused `rate_limited` | [`1a88f79f`](https://api.outlayer.ai/attestations/by-call/1a88f79f-49dd-45fb-bcae-96b746f38423) ✓ | [26_balance_final.json](docs/evidence/mainnet-e2e/26_balance_final.json) |
| 27 | `balance` after the window | ok | [`6b992a3c`](https://api.outlayer.ai/attestations/by-call/6b992a3c-5909-4a75-a694-dd08918e33da) ✓ | [27_balance.json](docs/evidence/mainnet-e2e/27_balance.json) |
| 28 | `withdraw` wNEAR → native NEAR to `keyhole-devmo.near`, request `633af674` | ok | [`afc0f232`](https://api.outlayer.ai/attestations/by-call/afc0f232-7d93-4a0e-8768-f62f245c537e) ✓ | [28_withdraw_wnear.json](docs/evidence/mainnet-e2e/28_withdraw_wnear.json) |
| 29 | `withdraw` USDC to `keyhole-devmo.near`, request `4330a163` | ok | [`a39fffd9`](https://api.outlayer.ai/attestations/by-call/a39fffd9-201b-4af2-927f-94a90d54cbf5) ✓ | [29_withdraw_usdc.json](docs/evidence/mainnet-e2e/29_withdraw_usdc.json) |
| 30 | `balance` final: empty, funds recovered | ok | [`3ef04098`](https://api.outlayer.ai/attestations/by-call/3ef04098-f287-4527-a8f2-52511beaa9e3) ✓ | [30_balance_final.json](docs/evidence/mainnet-e2e/30_balance_final.json) |

## Implementation facts checked by the claim ledger

- The public contract uses NEP-177 metadata (`KEYHOLE` / `KEY`), NEP-330 version `2.4.0`, `MAX_ROYALTY_BPS = 1000` and `MAX_TIER = 3`. Source: [contract](contracts/keys/src/lib.rs).
- New-owner withdrawal cooldown: `TRANSFER_COOLDOWN_MS` = 600,000 ms. Source: [worker](tee/worker/src/lib.rs).
- Global limits: 120 requests per minute and 25 free mints per day. Source: [recorded info](docs/evidence/mainnet-e2e/01_info.json).

| Tier | Per trade | Per day | Requests/min |
|---|---|---|---|
| 1 Bronze | $1 | $5 | 6 |
| 2 Silver | $10 | $50 | 12 |
| 3 Gold | $100 | $500 | 30 |

- **Allowlist:** the public gateway's allowed operations are defined by `ALLOWED_OPS` in [web/lib/gateway.ts](web/lib/gateway.ts). It rejects `copy` and `sweep_minter`. Both refusals are `bad_op`.
- Gateway bodies over 8 KB are rejected with 413. Each IP gets 20 calls a minute. Source: [route](web/app/api/worker/route.ts).
- The AI page uses `Qwen/Qwen3.6-35B-A3B-FP8`. Source: [AI client](web/lib/ai.ts).
- The `html` is `lang="en"`; a request to `/ar` redirects to the unprefixed path (A request to `/ar` is checked in the claim ledger). Source: [layout](web/app/layout.tsx), [config](web/next.config.ts).
- Security headers include CSP, HSTS (2 years, preload), nosniff, referrer and permissions policy. Source: [config](web/next.config.ts).
- The home page key count is `nft_total_supply` minus the test key the contract holds. The public key count is re-read from mainnet; configuration is independently read by the README quick path.
- `/api/health` reports service availability. The browser verifier shows 37/37 only when its individual checks pass; the home page describes the 37-check path. Source: [CallVerifier](web/components/judge/CallVerifier.tsx).
- The historical performance artifact is [lighthouse.json](docs/evidence/lighthouse.json); it is not a fresh performance measurement.
- The optional ambient audio is **CC0**: [license](web/public/audio/LICENSE.txt).

## Additional recorded call identities

These are historical call/build bindings, not fresh executions.

- [740191ec-48a4-4bbb-87f9-906b27c8116e](https://api.outlayer.ai/attestations/by-call/740191ec-48a4-4bbb-87f9-906b27c8116e) — recorded build `d337e822`.
- [d03f935f-dfc4-4548-8109-b9aabb5560fc](https://api.outlayer.ai/attestations/by-call/d03f935f-dfc4-4548-8109-b9aabb5560fc) — historical recorded call; exact build is printed by the claim verifier.
- [7d42db8d-d786-457f-b505-a96359f82393](https://api.outlayer.ai/attestations/by-call/7d42db8d-d786-457f-b505-a96359f82393) — historical recorded call; exact build is printed by the claim verifier.
- [c23f7bbf-c37c-4327-8edd-e773d3a8324f](https://api.outlayer.ai/attestations/by-call/c23f7bbf-c37c-4327-8edd-e773d3a8324f) — historical recorded call; exact build is printed by the claim verifier.
- [7f52f7d8-e4f6-4290-97e8-0754b90bcfc8](https://api.outlayer.ai/attestations/by-call/7f52f7d8-e4f6-4290-97e8-0754b90bcfc8) — historical recorded call; exact build is printed by the claim verifier.
- [a6b78742-f5ed-436b-845d-da5880f63ea1](https://api.outlayer.ai/attestations/by-call/a6b78742-f5ed-436b-845d-da5880f63ea1) — historical recorded call; exact build is printed by the claim verifier.
- [fffe6327-2e0c-47c5-9942-bf785c8c152a](https://api.outlayer.ai/attestations/by-call/fffe6327-2e0c-47c5-9942-bf785c8c152a) — historical recorded call; exact build is printed by the claim verifier.
