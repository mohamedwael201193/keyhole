# Earned tier, then a sale, on build cc8d2fa8 and contract v2.4 (2026-11-08 23:54 to 2026-11-09 00:35 UTC)

Team test wallets only. Seller A is `0705fdc1…8228` (a test holder). Buyer B is `3bde8ce5…8447`. The key is `k5f4750858f328940`. Neither wallet is an independent user.

The run shows the two new contract and worker paths together. A key first rises from tier 1 to tier 2 through `level_up`. Then the key is listed for sale. While it is listed, the enclave refuses the seller's withdraw and swap, and it still reads the seller's balance. After the sale, the old owner is refused and the buyer keeps the key and its tier.

Attestation JSON is saved as served, in this folder, for the calls marked "attested". Every call here ran on build `cc8d2fa8` (`executed_wasm_sha256` = `wasm_hash`, TDX quote present, 6,676 chars). The outputs of these calls are not in the repository; the attestation API returns only the output hash. The results in the table are the ones recorded for the run.

## Steps

| Step | Id | Link | Result |
|---|---|---|---|
| Funding: wNEAR deposit into A's vault (0.5 wNEAR, deposit address `db32f735…`) | from account op call `727e76ed-0f89-47c0-9b7a-60eac62ef413` | tx [`EAfYB19N…`](https://nearblocks.io/txns/EAfYB19NK5YUJEDnLWQ91BEiDbLvDo2dE2ARRebQ1HHR) | success (signer `keyhole-devmo.near`, `storage_deposit`, `near_deposit`, `ft_transfer` on `wrap.near`) |
| Funding: NEAR to A | — | txs [`7kbQ4Euo…`](https://nearblocks.io/txns/7kbQ4Euoyxu3cmwLuQEtJzT41JrRHJBDbb4ZeFRyexFf), [`7R1pgf5L…`](https://nearblocks.io/txns/7R1pgf5LbSJodSppFNuTwz8rPLVtbifkthvd2wiU5j3N) | success (`Transfer`, signer `keyhole-devmo.near`) |
| Funding: NEAR to B | — | txs [`8LMrVnka…`](https://nearblocks.io/txns/8LMrVnka1BmvTEevY8oN7amaN8Vw3QUvAsWh4X1zRevz), [`ABy9MYQz…`](https://nearblocks.io/txns/ABy9MYQzPgjoh5LLXP2tZmz6ykGF9oJRawtzwb9p5gqK) | success (`Transfer`, signer `keyhole-devmo.near`) |
| Swaps by A, ten calls, all status success, volume 5,609,200 µUSD | `35668a9d…`, `af56f5b9…`, `fcb0ebf5…`, `78f2488c…`, `97948762…`, `945026a3…`, `a59324f5…`, `b7c612da…`, `ed705230…`, `9db305e7…` | per call: `https://api.outlayer.ai/attestations/by-call/<id>` | success. Attestations for these ten calls are not saved in this folder |
| **level_up by A** | [`02a4e30d-8e75-4587-9507-56a247751fc5`](https://api.outlayer.ai/attestations/by-call/02a4e30d-8e75-4587-9507-56a247751fc5) (attested, [file](attestation_02a4e30d.json)) | `level_up` tx [`Ff4nibRd…`](https://nearblocks.io/txns/Ff4nibRd3XMdEgRXwGyDteLFXRdXwqEmY6FJqo2PsNvs) (signer minter `015a0259…`, receiver `keyhole-devmo.near`, `nft_set_tier`) | tier 1 to 2. `nft_metadata_update` emitted. `nft_tier` now 2 |
| **A lists the key**, 0.1 NEAR | — | tx [`4kQnM9Fj…`](https://nearblocks.io/txns/4kQnM9FjEKvXXEtenePc7LfdTtyLNbFirx5X8ytnvm1h) (`nft_list`, event `key_list`) | success |
| **While listed: A's withdraw refused** | [`61c6f3ad-e1fc-495c-8435-27fd3382c3df`](https://api.outlayer.ai/attestations/by-call/61c6f3ad-e1fc-495c-8435-27fd3382c3df) (attested, [file](attestation_61c6f3ad.json)) | enclave call | refused, code `listed` |
| **While listed: A's swap refused** | [`c791779a-7948-4614-abe0-5376916edeb0`](https://api.outlayer.ai/attestations/by-call/c791779a-7948-4614-abe0-5376916edeb0) (attested, [file](attestation_c791779a.json)) | enclave call | refused, code `listed` |
| While listed: A's balance read allowed | [`314e34ca-8868-445b-b62b-bf53621c8068`](https://api.outlayer.ai/attestations/by-call/314e34ca-8868-445b-b62b-bf53621c8068) (attested, [file](attestation_314e34ca.json)) | enclave call | ok. Reads are not frozen |
| **B buys the key** | tx [`BbTs3JZa…`](https://nearblocks.io/txns/BbTs3JZaxdrgwPu6SjZQwjpuXk7wAxizeVqzKrS2pxNp) (`nft_buy`, `nft_transfer` with memo `sale`, event `key_sale`) | NEAR tx, signer B | success. Royalty 0.005 NEAR to the treasury |
| **After the sale: A's balance refused** | [`eeb03a55-6df0-4ef3-af5b-3e9df3331f4e`](https://api.outlayer.ai/attestations/by-call/eeb03a55-6df0-4ef3-af5b-3e9df3331f4e) (attested, [file](attestation_eeb03a55.json)) | enclave call | refused, code `not_owner` |
| **After the sale: B's dashboard** | [`d5077866-7353-4e4d-b5e3-4c932beb8845`](https://api.outlayer.ai/attestations/by-call/d5077866-7353-4e4d-b5e3-4c932beb8845) (attested, [file](attestation_d5077866.json)) | enclave call | ok. Shows tier 2, the vault at 97,533 USDC units and 0.4687 wNEAR |
| **After the sale: B's withdraw refused** | [`2a1aed5b-d4e2-45d2-8915-14a5e61a8b12`](https://api.outlayer.ai/attestations/by-call/2a1aed5b-d4e2-45d2-8915-14a5e61a8b12) (attested, [file](attestation_2a1aed5b.json)) | enclave call | refused, code `cooldown` (the 10-minute transfer cooldown) |

## Notes

- The seller's listed-state refusals (`listed`) show that a listed key's account is frozen for value moves, as in the worker change in [#173](https://github.com/mohamedwael201193/keyhole/pull/173). The balance read is still allowed.
- `level_up` is the first tier change on chain for this key. Its tier goes up by one step, and the contract refuses any lower value (see [`contracts/keys/README.md`](../../../contracts/keys/README.md)).
- The buyer's vault amounts are as recorded in the run. They are test-wallet balances.
- Nothing here is an independent user, a sale to a third party, or a production payment. It is a test run on test wallets, on the build and contract described in [`publish-cc8d2fa8`](../publish-cc8d2fa8/README.md) and [`contract-v2-4`](../contract-v2-4/README.md).

## UI test from a real Meteor wallet: list and unlist key 0

The owner's Meteor wallet ran the sale buttons in the app on key `0` (seller `keyhole-devmo.near`, the contract account). Both transactions are on mainnet and were checked by RPC status, signer `keyhole-devmo.near`, receiver `keyhole-devmo.near`.

| Step | Id | Link | Result |
|---|---|---|---|
| `nft_list` for token `0`, price 100 NEAR (1e26 yoctoNEAR) | tx [`8nVr98N2…`](https://nearblocks.io/txns/8nVr98N2vYeTAaNiMtGWvge9fiAfoDSSBQL1wnSaTCwH) | success, method `nft_list` |
| `nft_unlist` for token `0` (the seller unlists; the listing deposit returns to the seller) | tx [`2v6Nw9Ww…`](https://nearblocks.io/txns/2v6Nw9WwkbGCoG6PCT2wBRh5bfikLNtoQ6PcHGnbnPQ9) | success, method `nft_unlist` |
