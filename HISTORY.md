
## 2026-11-01 — Design polish (landing, vault, mint)
- Landing: privacy section is now a two-column "Public chain / Sealed vault" split with warmer, smaller art; the "Check the seal" chest is smaller and balanced with the attestation card.
- Motion: CSS hero entrance, staggered IntersectionObserver scroll reveal (fade + slide-up, only below the fold), slow float on the art, light parallax on the hero key, hover lifts. GSAP reveal removed from the landing. Off under prefers-reduced-motion and `?static`.
- Vault empty state: key is a modest accent; mint: smaller preview, softer foil, compact 4-up finish picker, tighter step pills.
- Checked at 1280/1024/390 (qa_design2 before/after shots).

## 2026-11-01 — Design round 2
- Privacy cards use separate cropped art (glass chain / chest), each centred and unclipped.
- Guardrail values are one small pill style ("keyhole-bound", "5-min window", "6/12/30 per min").
- Mint preview card is 230px and no longer repeats the "Minting issues a Bronze key" line.

## 2026-11-01 — Worker 6367401a published
- PRs #37 (private AI on NEAR AI Cloud) and #38 (worker batch: signed PnL, request binding, locked_until_ms, sub-cent fix, invariant tests) merged.
- FastFS upload oGGRn6jW… (expected revert), add_version AJWVEN6F…; live info f4768da8 (attestation 1227292) executed 6367401a.
- Pointers moved to 6367401a; 67c5cd77 listed as previous.

## 2026-11-01 — Live PnL/status check and Intel DCAP in the browser
- Test key A (3bde8ce5…, token k5f4750858f328940) on worker 6367401a: status 3e53ce83 shows locked_until_ms (null) and holder limits; pnl dda27438 is signed by the minter and the /pnl page verifies it; quote 4eae763a is refused with "amount $0.0099 exceeds your per-trade cap $0.0020" (sub-cent wording fixed).
- /verify now parses the TDX quote and runs 19 Intel DCAP checks in the browser (quote signature, QE report binding, Intel QE signer, PCK chain to the pinned Intel SGX Root CA, validity dates, debug off, report_data equal to the attested fields), plus the 6 existing checks. It also shows the key, request hash and nonce a signed answer is bound to. Not checked: Intel CRL and TCB status (need Intel PCS).

## 2026-11-01 — Key history page and a transfer during a payout on mainnet
- New public page /key?id=… shows holders (from/to, deposits, paid out, trades) and the full event log. It re-checks every hash link, the head, the ed25519 head signature and that the signer is the TEE minter, in the browser. Amounts stay sealed. Linked from the vault key log.
- Mainnet run (docs/evidence/mid-payout/README.md): B signed a 0.003 USDC withdraw at 06:23:00; the key moved B→A at 06:23:04–06:23:18 (tx 144iK9uj…); the payout finished at 06:23:28 to B. B's next request: not_owner. A sees exactly 0.002 USDC. A withdraw within 10 minutes of a transfer: cooldown.

## 2026-11-01 — Prompt-injection attack log, key scoping, /ask context fix
- Six mainnet attack calls by an "obedient" agent holding key A: payout to attacker.near (bad_params), $2 drain (over_cap_per_tx), cap raise (pending 24 h), replay (replay), edited recipient (bad_signature), old holder (not_owner). docs/evidence/prompt-injection.
- /ask: pasted context sent a second system message, which the model API rejected (ai_upstream). Context now goes in the user turn inside <shared_context> tags, with a system rule never to follow it. New "Attack test" sample.
- README: key scoping table (FullAccess / FunctionCall keys read from RPC) and agent guidance.
