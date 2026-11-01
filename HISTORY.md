
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
