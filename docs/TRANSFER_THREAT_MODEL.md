# Transfer threat model (key NFT sale)

Actors: **S** seller (old owner), **B** buyer (new owner), **M** marketplace calling `nft_transfer_payout`, **E** the enclave.

| # | Threat | Control | Test / evidence |
|---|---|---|---|
| T1 | S keeps operating the account after the sale | Owner read live from `nft_token` on every request; signer must equal owner | `transfer_then_old_signature_is_not_owner`; mainnet call [e805f050](https://keyhole-seven.vercel.app/verify?call=e805f050-d416-4a04-9b12-270adbe02068) `not_owner` |
| T2 | S starts a withdraw, then sells; the payout lands anyway | Second owner check right before submit; spend rolled back | `invariant_transfer_mid_payout_never_settles_for_the_old_holder`, `transfer_while_withdraw_is_pending_does_not_send`; call [e72dc176](https://keyhole-seven.vercel.app/verify?call=e72dc176-e6fc-4d89-b348-911f5318b81b) |
| T3 | S races B with a request signed just before the transfer | 10-minute withdraw cooldown for the new owner; single-use nonces | `withdraw_waits_after_a_transfer_only_for_the_new_owner`, `invariant_cooldown_binds_only_the_latest_transferee`; call [369f522d](https://keyhole-seven.vercel.app/verify?call=369f522d-4bef-4b17-9071-1de01616eef6) `cooldown` |
| T4 | Replay of S's old signed request after the sale | Nonce store + expiry + live owner check | replay rows in `tee/worker/src/matrix.rs` |
| T5 | B buys a key whose balance S drained right before sale | S can lock the key for sale; B checks a signed balance proof (`prove`) before paying | `seller_lock_binds_only_the_owner_who_set_it`; `/key` balance proof |
| T6 | Lock used to trap B | Lock binds only the owner who set it | `seller_lock_binds_only_the_owner_who_set_it` |
| T7 | Royalty split wrong or token not moved during a marketplace sale | NEP-199 `nft_transfer_payout` moves the token and pays the treasury share in one call | contract tests `nep199_transfer_payout_emits_event_and_splits`, `nep199_payout_conserves_balance`, `transfer_payout_moves_token` |
| T8 | Re-mint to get a second key for the same account | Mint refused once the minting account's token exists or was transferred | `re_mint_after_transfer_is_refused_before_sending` |
| T9 | Custody key extracted to bypass the NFT | Wallet credentials exist only in enclave storage; never returned by any op | wallet record in `holder_wallet`; attested build `tee/worker/DEPLOYED_SHA256` |
