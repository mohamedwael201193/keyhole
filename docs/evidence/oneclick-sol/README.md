# 1Click cross-chain settlement, Solana → NEAR (mainnet, 2026-11-02)

| Order | Deposit address | Origin tx | Outcome | Evidence |
|---|---|---|---|---|
| 0.004 SOL → USDC on NEAR | `6pvcZZ2xMUhDpQmySGaVR2Cm9e3Aixx5QUQUPS7RAcha` | [Solana `2GxLCAXc…`](https://solscan.io/tx/2GxLCAXcEjTQ6NraySheBYFuN7XGAZym96Dqtcdypy8LNrH1UEAfg2566gaGQey4q3YyjMKuhE4cN7RdTMQq94Xv) | `SUCCESS` at 20:20:50 (UTC+2): 0.367068 USDC to `keyhole-devmo.near` in [NEAR `8BQznSfb…`](https://nearblocks.io/txns/8BQznSfbQUecDqCcEFwQj4vzr5x1X4rzLSLpszktf8fh) | [quote](b7_real_sol_to_near_usdc_4000000.json), [status](c6_status_success_4000000.json), [live status](https://1click.chaindefuser.com/v0/status?depositAddress=6pvcZZ2xMUhDpQmySGaVR2Cm9e3Aixx5QUQUPS7RAcha) |
| 0.001 SOL → USDC on NEAR (refund path) | `5sESFfrM4Tk6L5euDCTjjMxVAs5xmbZpj4i3V29s3KJ` | [Solana `4ws4iem4…`](https://solscan.io/tx/4ws4iem4khPUaQBBVCN9hAy1xE5fpb6dX2oVvgQZvBUvJGbZXDrSop76Cm5esge2xVB7W6h3BRPhAfpN6ioNEK8P) | `REFUNDED`, reason `NO_LIQUIDITY`: 0.00089235 SOL returned in [Solana `5qumXJw4…`](https://solscan.io/tx/5qumXJw4bCdfGzSbVP4Vas12JMkxWEuqaPpzWhHKoTYmxpifbowQKuL1hv9WxyMd9TrNe93WrivimTUcEcok7tPy) | [status](status_refunded_5sESFfrM.json), [live status](https://1click.chaindefuser.com/v0/status?depositAddress=5sESFfrM4Tk6L5euDCTjjMxVAs5xmbZpj4i3V29s3KJ) |

Both cards on [/settle](https://keyhole-seven.vercel.app/settle) read these statuses live from 1Click.
