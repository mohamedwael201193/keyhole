# Landing assets (web/public/landing)

Converted from D:
oute
ear\KEYHOLE\landing_concepts
aw by the Python PIL script and ffmpeg (WebP, AVIF where noted, MP4 and WebM with faststart). Sizes below are the files as shipped.

Real key art is not generated: the keys on the page are web/public/heirloom/keys/k03.webp (Bronze, the hero, the keyhole moment and the pledge line). Generated images are backgrounds and atmosphere only.

Not used on the page: 05_key_bronze_float (replaced by the real k03 art), 11_step_transfer and 12_pledge_lock (the key there is a different design). Not converted at all.

## Files

| File | Source | Size | Use | Dimensions |
|---|---|---|---|---|
| `hero-vault.webp` | `01_hero_vault.png` | 138 KB | Hero poster (video poster, no key) | 1376x768 |
| `hero-loop.mp4` | `02_hero_loop.mp4` | 435 KB | Hero loop, H.264, faststart, 1280x720, 8 s, no audio | 1280x720 |
| `hero-loop.webm` | `02_hero_loop.mp4` | 245 KB | Hero loop, VP9, 1280x720, 8 s, no audio | 1280x720 |
| `hero-loop-poster.webp` | `02_hero_loop.mp4` (frame 0) | 68 KB | Poster from frame 0 of the loop (fallback still) | 1280x720 |
| `keyhole-macro.webp` | `03_keyhole_macro.png` | 107 KB | Pinned keyhole plate (How it works) | 1376x768 |
| `keyhole-macro.avif` | `03_keyhole_macro.png` | 55 KB | AVIF of the keyhole plate (not inside a mask) | 1376x768 |
| `key-trio.webp` | `04_key_trio.png` | 203 KB | Trio of real-design keys; converted, not placed by DESIGN_SPEC | 1600x900 |
| `problem-paper.webp` | `06_problem_paper.png` | 92 KB | The problem: square crop, centre | 768x768 |
| `problem-paper.avif` | `06_problem_paper.png` | 52 KB | AVIF of the problem still | 768x768 |
| `lockout-left.webp` | `07_lockout_left.png` | 219 KB | Lock-out panel: previous holder (refused) | 896x1200 |
| `lockout-right.webp` | `08_lockout_right.png` | 180 KB | Lock-out panel: new holder (account open) | 896x1200 |
| `step-mint.webp` | `09_step_mint.png` | 52 KB | How it works, step 01 (Mint), foil card art | 512x512 |
| `step-use.webp` | `10_step_use.png` | 51 KB | How it works, step 02 (Use), foil card art | 512x512 |
| `foil-texture.webp` | `13_foil_texture.png` | 160 KB | Pledge section ground, darkened | 1376x768 |
| `stone-texture.webp` | `14_stone_texture.png` | 187 KB | Live proof section ground, darkened | 1376x768 |
| `stone-texture.avif` | `14_stone_texture.png` | 187 KB | AVIF of the stone ground | 1376x768 |
| `footer-arch.webp` | `15_footer_arch.png` | 27 KB | Close section, full-bleed arch | 1376x590 |
| `footer-arch.avif` | `15_footer_arch.png` | 11 KB | AVIF of the arch | 1376x590 |
| `og-image.webp` | `16_og_image.png` | 117 KB | Social preview (og:image, 1200x630) | 1200x630 |

## Generation prompts (Higgsfield, in Claude chat)

Models: nano_banana_pro at 2k for images; seedance_2_0 at 720p, no audio, for the loop. Prompts copied from `landing_concepts/HIGGSFIELD_PROMPTS_FOR_CLAUDE_CHAT.md`.

Shared prefix (added once to every chat): keep the key design EXACTLY as in the k03/k04/k02 references; no text, letters, logos, people or watermark; dark premium vault, deep teal-black, brass and copper highlights, warm golden light.

### `01_hero_vault.png`

Monumental dark stone vault with a tall arch like the arch reference. Warm golden light pours from inside the arch, volumetric haze and floating dust, deep teal-black shadows at the edges. Large calm empty dark area on the left third for a headline; empty space centre-right where a key will be placed later. No key in this image.

### `02_hero_loop.mp4`

Very slow camera push toward the glowing arch, haze drifting gently, the light softly breathing. Calm, seamless motion that can loop. Nothing new appears.

### `03_keyhole_macro.png`

Macro photograph of an antique brass keyhole set into dark stone, the keyhole shape matching the cut-out in the key reference, warm raking light from the right, fine metal grain, shallow depth of field, dark surroundings. Used behind the scroll animation where the key enters the lock.

### `04_key_trio.png`

The three keys from references k03 (Bronze), k04 (Silver) and k02 (Gold) standing upright side by side on a dark stone ledge, identical size, identical spacing, identical warm rim light, soft reflections, exact same designs.

### `06_problem_paper.png`

A crumpled sheet of paper with an unreadable smudged handwritten scribble lying on a dark desk next to an open old ledger, cold dim light, a sense of something private being handed over carelessly. No readable characters at all.

### `07_lockout_left.png`

A heavy dark stone door firmly closed, cold blue-grey light, a brass lock with no key, frost-like stillness. Represents access refused.

### `08_lockout_right.png`

The same style of stone door slightly open, warm golden light spilling out through the gap, the Bronze key from reference k03 resting in the lock, exact same design. Represents access granted.

### `09_step_mint.png`

The Bronze key from reference k03 being formed from molten copper light in a dark forge-like space, sparks of gold, the key already clearly shaped, exact same design.

### `10_step_use.png`

A sealed dark vault chamber seen through the arch, small streams of golden light flowing in and out like quiet transactions, a brass dial and lever on the wall. No key.

### `13_foil_texture.png`

Abstract macro of brushed brass foil with a faint engraved guilloche line pattern, dark vignette edges, subtle and even, usable as a background.

### `14_stone_texture.png`

Seamless dark teal-black stone texture with very subtle brass flecks, even lighting, no strong features, usable as a tiling background.

### `15_footer_arch.png`

Wide view of the vault arch from far away, small warm glow in the distance, mostly darkness, very calm, for the footer.

### `16_og_image.png`

The three keys from k03, k04, k02 side by side, centred, in front of the glowing arch, dark teal background, equal size, exact designs, generous margin on all sides.

## Post-processing

- Images: PIL, LANCZOS resize where a slot needs it, WebP quality 86 (lowered in steps of 4 until the budget was met), AVIF quality 60 for the plain backgrounds.
- Budgets: hero poster 250 KB, other images 300 KB, textures 200 KB; all met.
- Video: `ffmpeg -i 02_hero_loop.mp4 -an -vf scale=1280:720 -c:v libx264 -preset slow -crf 27 -movflags +faststart hero-loop.mp4`; WebM with `-c:v libvpx-vp9 -b:v 0 -crf 38`. Both under 2 MB.
- Review: contact sheet checked by eye. No readable text in any still. 15_footer_arch is very dark by design.
- Known gap: the lock-out right panel shows a generated door key that is not the k03 design (the spec allows atmosphere only; flagged for the lead).
