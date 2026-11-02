
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

## 2026-11-01 — TRACK_COVERAGE.md and honest counts
- TRACK_COVERAGE.md maps every line of the nfts, privacy, defi and security prompts to a feature, proof and status (gaps marked ❌/🟡).
- 25 new web unit tests (evidence integrity, DCAP edge cases, key-log format, limiter, labels). Totals: 222 distinct tests (contract 15, worker 43, CLI 7, web unit 116, e2e 41 × 2 viewports). 8/10 integrations live.
- Live /ask answer to the poisoned note recorded in docs/evidence/prompt-injection.

## 2026-11-01 — 1Click settlements page (dry-run, live status, REFUNDED/FAILED)
- Minimums from dry quotes: Solana USDC → NEAR needs ≥ 0.010001 USDC; NEAR → Solana costs ~0.01 USDC in fees, so ≥ 0.02 USDC.
- Executed on mainnet from keyhole-devmo.near: 0.03 wNEAR → 0.131355 USDC (deposit BGyVQcr6…, SUCCESS); under-deposit 0.02 of a 0.05 USDC quote (deposit J2UwPe1X…, INCOMPLETE_DEPOSIT, refund due at the quote deadline 2026-11-04 07:30 UTC+2). A first 0.05 USDC deposit attempt failed for low balance (no funds moved).
- New /settle page: dry-run quotes (server forces dry:true), live status for each executed order with "where the funds are" and explorer links, a clearly labelled recorded FAILED example, and a legend for every status. ONECLICK_API_KEY added as a sensitive Vercel env var.

## 2026-11-02 — Base → Solana settlement from a MetaMask wallet
- Real 1Click order: 0.6 USDC on Base (tx 0x0e46c0f0…, deposit 0xF60390Eb…) → 0.006268509 SOL to 3TsdHmQS… on Solana (tx JYbHtieC…), SUCCESS in about 90 s. Shown on /settle with Basescan and Solscan links.
- 2026-11-02: 0.001 SOL → USDC on NEAR from MetaMask (Solana sig 4ws4iem4…, finalized, 1,000,000 lamports at deposit 5sESFfrM…). 1Click deposit/submit returned 500 (timeout) twice; status stayed PENDING_DEPOSIT for 20+ minutes. Listed on /settle with its live status.

## 2026-11-02 — Contract standards tests (15 → 43)
- New unit tests for NEP-171 (mint/transfer events, 1 yocto, owner-only, no self-transfer, duplicate ids), NEP-177 metadata, NEP-181 enumeration and paging, NEP-199 payout conservation over many balances, rounding, zero and max royalty, treasury-as-owner, minter rotation, beat batch limits, init royalty cap. Total distinct tests 250.
