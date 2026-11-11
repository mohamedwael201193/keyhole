# v2.6 operator preflight — release held, not deployed

Reviewed merged source: `9d661db70a70e00e4d23544fc75dbc523d17e626`.

No mainnet transaction, paid worker call, Vercel mutation, identity promotion or push was performed. No lending, provisioning or loan action was attempted. There is no original deploy hash because nothing was signed or sent. Fees spent: **0 NEAR / $0 compute**. Maintenance on/off times: **not applicable; unchanged**.

## Verified

- Exact reviewed contract candidate: 487260 bytes, `54ba51b3d7d256820e751c9fa4e0cda55c66b30111a186c6d9eff03b561b7b8a`.
- Live code remains v2.5: 485855 bytes, `28cbe755268145d1e675106c8b9834e2c2b05baafccd3296e894072ecdaa25ce`.
- Fresh public before/final captures: six complete NFTs, six controls, eight credit accounts and 47 raw rows. Full raw state, token ownership, epochs, credits, configuration, metadata and code match across the captures. Lending remains disabled; all controls idle; credits/pending payouts zero/null.
- Official CLI confirms the original mainnet project owner and public signing key; the saved deployer public key is current FullAccess. No key change or signing occurred.
- Dedicated KEYHOLE Vercel token selects the correct user/team/project. No alternate account, connector or browser was used. Public production aliases still return 400 for invalid JSON, not a maintenance barrier. The two tested immutable deployment URLs return 401/no-store.
- Payment nonce 1: available 514657 microUSD, reserved 0. Last use **10 November 2026, 19:31:11 Africa/Cairo**. No top-up was attempted.
- A real release Ed25519 keypair was generated. Only its public root is included here; the private key is mode 600 outside Git. It is not a complete enrolled trust packet.

## Mandatory hold

`submitter-inventory-review.json` records actual source entry points and limits. The gateway, CLI/MCP direct mode and operator OutLayer path must be enrolled against their real controllers, with actual pause/drain acknowledgements. No complete reviewed controller inventory or signed pause evidence was available. A source-path list, zero payment reservation, latest-100 completed calls and idle contract controls do not justify fabricating complete provider/native UNKNOWN drain declarations. No undiscovered third-party submitter is asserted to exist.

A fresh predeploy run correctly refuses both `maintenance_and_submitter_drain` and `native_all_in_approval`. No PASS checkpoint, eligible `trust.json`, native approval, signed deployment or execution journal was manufactured. Deploy-post and restore were **not evaluated**; they were not falsely labelled failures or successes.

The selected production deployment predates the new first-in-handler maintenance code. Rebuilding that old source with a new env alone does not add the barrier: the approved reviewed source must actually be deployed and both aliases checked before any release signing.

Resolve the actual-controller inventory/enrollment and pause ownership first. Then follow the reviewed maintenance → fresh snapshot/approval → code-only original transaction → preservation → six worker-admin transactions → restore sequence. Keep all original-hash/no-retry protections. This preflight is not a new source defect or a demand for a provisioning/loan audit before a disabled-lending code deploy.

Public procedure sources: [OutLayer HTTPS API](https://app.outlayer.ai/docs/https-api), [payment-key reservation semantics](https://app.outlayer.ai/docs/payment-keys). Neither documents a temporary provider-global project pause via the web gateway. Key closure/deletion/rotation was not used as a workaround.
