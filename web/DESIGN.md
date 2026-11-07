# KEYHOLE design system (v3)

Direction: calm, fintech-grade. Cream paper, deep teal ink, warm brass accent, and one dark vault surface for hero moments. One accent per screen.

## Tokens

One source: `app/tokens.css`, imported first in `app/layout.tsx`. Everything else aliases it.

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--surface` page, `--raised` card, `--sunken` field, `--surface-warm` | |
| Ink | `--ink` headings, `--ink-2` body, `--muted` meta | `--muted` is AA on raised and surface |
| Lines | `--line`, `--line-strong`, `--field` | hairline, card edge, input border |
| Primary | `--primary`, `--primary-hover`, `--primary-ink`, `--primary-soft`, `--primary-tint` | teal: the main action, links, focus |
| Accent | `--accent`, `--accent-ink`, `--coral` | brass for eyebrows and fills; coral only for italic display words |
| Status | `--success`, `--warn`, `--danger`, `--info`, `--neutral-*` each with `-bg` | always printed with a label |
| Vault | `--vault`, `--vault-ink` | the dark surface, hero moments only |
| Focus | `--focus`, `--focus-ring` | |
| Type | `--text-display` 64, `--text-title` 36, `--text-heading` 22, `--text-lead` 18, `--text-body` 16, `--text-small` 13 | 13px is the floor |
| Fonts | `--font-display` (Cormorant, headlines only), `--font-ui` (Manrope), `--font-mono` (DM Mono, hashes and figures) | |
| Radii | `--radius-sm` 8, `--radius-md` 12 (fields), `--radius-lg` 16 (cards), `--radius-xl` 20, `--radius-pill` | |
| Elevation | `--shadow-1`, `--shadow-2`, `--shadow-soft`, `--shadow-lifted`, `--shadow-glow` | |
| Spacing | `--space-1` (4px) to `--space-8` (72px) | |
| Motion | `--dur-fast` 150ms, `--dur-base` 250ms, `--dur-slow` 600ms; `--ease-out`, `--ease-std`, `--ease-spring` | reduced motion switches animation off in `polish.css` |

## Legacy aliases

The older blocks keep their names so existing class styles do not change:

- `polish.css` `:root`: `--bg` to `--surface`, `--sf` to `--raised`, `--mu` to `--ink-2`, `--teal` to `--primary`, `--brass` to `--accent-ink`, `--ln` to `--line`, `--kh-edge`, `--kh-field`, the status pairs (`--ok-*`, `--info-*`, `--warn-*`, `--bad-*`), `--banner` to `--vault`, `--kh-shadow*`, `--r-*`, and the `--fs-*` sizes.
- `heirloom.css`: `--serif`, `--sans`, `--mono` to the font roles.
- `ui.css`: `--ok`, `--bad`, `--waitc`, `--info`, `--ring` and their backgrounds to the tokens.
- `globals.css` `@theme`: `--color-*` and the font utilities.

Do not reintroduce a literal colour for a name a token already covers. Do not alias a name to itself: a token defined in `tokens.css` is removed from the legacy block, not redefined.

## Rules

- Display serif for headlines only. Body and labels in Manrope. Mono only for hashes, addresses and figures.
- One primary button per screen. Buttons: `primary`, `secondary`, `ghost`, `danger`; sizes `sm`, `md`, `lg`.
- Status is a word and a tone together, never colour alone.
- Motion: one entrance per page, micro-interactions (button press, card lift 2px), no scroll-linked motion on app screens. Everything respects `prefers-reduced-motion`.
- Components live in `components/ui`. Extend them; do not duplicate.
