# Transfer during a payout, on NEAR mainnet (2026-11-01, worker 6367401a)

Key `k5f4750858f328940`. Holder A `3bde8ce5…8447`, holder B `0705fdc1…8228`. Tiny amounts (USDC base units, 6 decimals). Times are Africa/Cairo (UTC+2).

| Step | What happened | Proof |
|---|---|---|
| 1 | A gets a deposit address for 5000 (0.005 USDC) | call `6c1e58a1-299a-4840-b217-ed9607f3cab5` |
| 2 | 0.005 USDC sent to it; A's sealed balance shows 5000 | tx [`D4HLoHXH…`](https://nearblocks.io/txns/D4HLoHXHqBefNJUoKdD3Pd7qUtmJpQYqyXoJpzGpAQ76) |
| 3 | Key A → B | tx [`HbRCvUig…`](https://nearblocks.io/txns/HbRCvUigk6gcvdjVtgtVsM8gYYQ4HsmWCJmHAqCenY68) |
| 4 | B sees the 5000 balance with tier caps (A's own limits do not follow the key) | calls `5bbe1684…`, `69285c72…` |
| 5 | B → A and back to B; B's withdraw inside 10 minutes of receiving the key is refused | txs [`9crSgx42…`](https://nearblocks.io/txns/9crSgx42Qz4p7EwMuefFneCmbj1DuZ568z4QFGzhARFv), [`H86SdV6L…`](https://nearblocks.io/txns/H86SdV6LCEjxmArAr4TYKsFfeHCDMXYBjtnQoYkknhBi); call [`369f522d`](https://keyhole-seven.vercel.app/verify?call=369f522d-4bef-4b17-9071-1de01616eef6) `cooldown` |
| 6 | **06:23:00.4** B signs a withdraw of 3000 to B | call [`129161f9`](https://keyhole-seven.vercel.app/verify?call=129161f9-2534-4a3f-9544-44f8da9dd7c2) |
| 7 | **06:23:04.4 → 06:23:18.1** while that payout is in flight, B transfers the key to A | tx [`144iK9uj…`](https://nearblocks.io/txns/144iK9ujaowrUdXySfvGDDjobV2Q5YyJsNPK3KL2GYnc) |
| 8 | **06:23:28.3** the payout finishes: 3000 to B, the holder who signed it. B's on-chain USDC is 3000 | call `129161f9` output `ok`, `ft_balance_of` = 3000 |
| 9 | B tries again after the transfer: refused | call [`e72dc176`](https://keyhole-seven.vercel.app/verify?call=e72dc176-e6fc-4d89-b348-911f5318b81b) `not_owner` |
| 10 | A (new holder) sees exactly the rest: 2000. Nothing paid twice, nothing lost | call [`f36d9b54`](https://keyhole-seven.vercel.app/verify?call=f36d9b54-417a-4b33-9598-c396ae852d4d) |
| 11 | The key's log shows every step, hash-chained and signed by the TEE minter | [/key?id=k5f4750858f328940](https://keyhole-seven.vercel.app/key?id=k5f4750858f328940), call `184b6075` |

Also seen: A's first in-flight attempt (2000) was refused by the bridge as too small before the transfer landed (`b4dcce62`), so step 6 used B and 3000.
Note: holder limits are bound to the holder's account. When A received the key back, A's own earlier limits applied again; a different holder starts from the tier caps.
