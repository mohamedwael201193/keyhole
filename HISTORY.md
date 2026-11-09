## 2026-11-09 — Harsh judge fixes (PR #186)
- `/judge` Step 4: handover calls labelled build `a985fd87` (their real executed_wasm), not "Current build". Regression test added.
- `/source/manifest.json` regenerated to current worker `d337e822` / contract `DEXHHyEM…`; CI hygiene checks tarball identity matches `identity.json`.
- `/verify` CallVerifier: separate verdict chips (quote validity, output binding, economic semantics, current-build identity) — extends the existing 37 checks, no duplicate page.
- "Signed PnL" renamed to honest **Signed swap log** (mark-to-market delta, not realized profit) across UI/README.
- OG/metadata host default → `https://keyhole-seven.vercel.app`.
- `/attack` already links each refusal to `/verify` and requires live attestation + evidence `error.code`.

## 2026-11-09 — Judge proof UX: live evidence pack + Attack desk (PR #186)
- Harsh AI-judge pass: Attack PASS now requires live OutLayer attestation AND `/evidence/<call>.json` error.code match (not quote-only). Primary CTA re-runs checks.
- `/verify` (app shell): live evidence table (contract code hash, operator keys, NFT supply, worker attestation, deploy/publish/handover txs) plus the existing 37 TEE checks.
- `/attack` ("Try to steal a key"): re-fetches real attested refusals and the handover tx; each card labels live check vs recorded mainnet evidence. No wallet, no value moves.
- README §3a Real vs simulated; SECURITY §11 operator-key note; nav + landing links.

## 2026-11-09 — Dashboard density on every app page (PR #185)
- Shared v7 density (page title/lead, cards, hero, rows, empty states) applies under `.app-main` so Swap, Vault, Keys/Mint, and Activity match the Overview ~80–90% zoom.
- Page CSS padding/gaps tightened on `.sw-page`, `.vlt`, `.kp-root`, `.act`. Landing `/` unchanged. Foil key cards kept.

## 2026-11-09 — v7 key cards restored + Overview density (PR #182)
- Gallery/details/Overview/mint key faces use FoilCard again (Guilloche, Hallmark, metal border, sheen). Overview sample is one clean metal frame (no nested Card edge).
- Overview type/padding/hero tightened so the signed-out dashboard fits 1440×900 and 1280×800 without vertical scroll; readable at 390×844.
- FoilCard no longer carries the shared `.card` class (polish was painting a second cream border over the metal frame).


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
- 2026-11-03 23:13 identity bump: identity.json → worker cff9fd3c (737639 B, add_version AepKgT8M…, info 643a012d, previous a55ebb14) via gen-identity; README/SECURITY/policy/verify.sh/claims pointers; vitest 869/869, claims 441/1 (site-hash waits for redeploy).

## 2026-11-09 21:47 Africa/Cairo (UTC+2) — Settlement epoch worker (feat/settlement-epoch-worker)
- Worker: per-key settlement epoch in enclave storage (`t/<token>/epoch`). Bumped on ownership sync (transfer/sale). Value-moves stamp the epoch; settle refuses `epoch_void` on drift; post-move reports `needs_review` via `after_move_status_epoch`.
- Freeze: `quote` with `execute: true` is refused while listed (`listing_blocks_ex` / H-1). Listing re-checked immediately before custody send. FREEZE_NOTE updated.
- SECURITY.md §1 and §9 rewritten for epoch + wet-quote freeze. README unchanged (no weakness language).
- Unit tests: 542 pass (added wet-quote, epoch void, epoch invariant). No mainnet publish.

## 2026-11-09 21:55 Africa/Cairo (UTC+2) — CI fix for settlement-epoch worker PR
- Clippy: drop unnecessary `as u64` in epoch invariant test (`r.below` is already u64).
- Web: register `epoch_void` in `WORKER_ERROR_CODES` + en.json error copy so p2-errors stays green.
- PnL-on-card / Attested Key Desk PnL dropped from the plan (swap-only; no invented metrics). Priority remains epoch + operator trust.
