# v7 shared components

Import everything from `@/components/v7` (the barrel is `index.ts`). Styles are in `v7.css`, loaded once from `app/layout.tsx`.
Colours, radii, shadows and motion come from `app/tokens.css`; do not add literal colours. Every animation stops under
`prefers-reduced-motion`. No component fetches data: the page passes real values in and the component draws them.

Rules for page agents:
- A value you do not have is shown as its honest state ("Checking", "Sealed", "Not read yet", "None yet"), never a made-up number.
- One primary action per screen. Every button and link does a real action; do not render a dead one.
- Put one italic rust phrase in a page title with `<em>`, for example `<>Mint your <em>key.</em></>`.

## PageHeader
Eyebrow (rust, uppercase), the page title in the display serif, and one plain line under it.
- `eyebrow: string`
- `title: ReactNode` (wrap the one accent phrase in `<em>`)
- `lead?: ReactNode` (one sentence)
- `actions?: ReactNode` (right side; wraps below on phones)
- `testid?: string`

## Card, CardHeader
`Card` is the raised warm surface (18px radius, soft shadow, warm edge).
- `Card`: `as?: "section" | "div" | "article" | "aside"`, `tone?: "raised" | "flush" | "vault"`, `interactive?: boolean` (hover lift, only for a card that is itself a control), `label?`, `labelledBy?`, `testid?`, `className?`, `style?`.
- `CardHeader`: `title: ReactNode` (serif), `id?` (point the card's `labelledBy` at it), `icon?: IconName` (line icon before the title), `meta?: ReactNode` (small text on the right, for example a count), `action?: ReactNode` (a link or button on the right), `level?: 2 | 3`.

## VaultHero
The dark teal vault banner with the arch art (`public/art/arch/arch-teal.webp`) on the right.
- `label?: string` (default "Vault balance")
- `value: ReactNode` (the balance text, or "Sealed". Pass a real value only from a signed read.)
- `sealed?: boolean` (adds the eye-off mark)
- `sub?: ReactNode` (one plain line)
- `actions?: ReactNode` (buttons: `variant="banner"` for the cream one, `className="v7-on-vault"` for an outline one)
- `chip?: ReactNode | null` (top-right; default "Mainnet", `null` hides it)
- `valueTestId?`, `testid?`

## StatusChip
A status word with its tone. The label is always printed.
- `tone?: "success" | "warn" | "error" | "neutral" | "info"`
- `icon?: "dot" | "check" | "alert" | "none"` (default "dot")
- `children: ReactNode` (the label)
- `testid?`

## TierChip
A finish as a solid chip: Bronze, Silver, Gold or Legendary. Any other text gets the neutral chip.
- `tier: string`
- `testid?` (goes on the name text, so tests can read it)

## ProofPanel
The proof card: enclave status, hardware, worker build (short, with copy), contract (explorer link), TEE attestation of the last call, last call id (short, with copy), and "Verify the last call".
- `title?` (default "Enclave & proof"), `headingId?`
- `enclave: "checking" | "live" | "down"`
- `hardware?` (default "Intel TDX")
- `workerBuild?: string | null` (full hash; shown short with copy)
- `contract?: string` (account id)
- `attestation: "verified" | "not-verified" | "unread"`
- `lastCall?: string | null` (call id)
- `verifyHref: string` (for example `/verify?call=<id>` or `/verify`)
- `verifyTestId?`, `testid?`

## SetupProgress
The setup checklist. Each item is computed by the caller from real state.
- `items: SetupItem[]`, where `SetupItem = { id, title, note?, done, action? }`. `action` is shown only while the item is open.
- `variant?: "vertical" | "horizontal"` (vertical for lists beside content; horizontal stepper for a banner row)
- `title?` (default "Setup progress"), `headingId?`
- `doneText?` (replaces the list when every item is done)
- `testid?`
Renders `data-testid="setup-<id>"` and `data-done="0|1"` on each item, and a "N of M" count.

## ListRow
One row: round icon, title and sub line, and on the right a value and a meta line. A row with `href` is a link, with `onClick` a button, otherwise plain.
- `iconName?: IconName` or `icon?: ReactNode` (for example a token mark)
- `tone?: "success" | "warn" | "error" | "neutral" | "primary"` (icon disc)
- `title: ReactNode`, `sub?: ReactNode`, `value?: ReactNode`, `meta?: ReactNode`
- `href?: string`, `onClick?: () => void`, `testid?`

## FilterChips
Pill filters with optional counts. Controlled.
- `items: { id: T; label: string; count?: number }[]`
- `value: T`, `onChange: (id: T) => void`
- `label: string` (group name for assistive tech), `testid?` (each chip gets `<testid>-<id>`)

## Segmented
A joined control for a short choice of views or ranges. Controlled.
- `options: { value: T; label: string }[]`, `value: T`, `onChange: (v: T) => void`, `label: string`, `testid?`

## IconButton
A square 40px icon-only control. Give `label` (the accessible name and tooltip).
- `label: string`, `icon: IconName`
- `href?: string` (link) or `onClick?: () => void` (button)
- `disabled?`, `tone?: "plain" | "solid"`, `testid?`

## CopyButton
Copies a value (`lib/copyText.ts`). The icon becomes a tick for 1.6 seconds and a live region says "Copied".
- `value: string`, `label?` (default "Copy"), `testid?`, `className?`

## EmptyState
A quiet empty list or unavailable state: title, one sentence, at most one action.
- `title: string`, `body: ReactNode`, `icon?: ReactNode`, `action?: ReactNode`, `testid?`

## Skeleton
A shimmering placeholder for a read that has not landed. Announces "Loading" once.
- `lines?: number` (default 3), `label?`, `testid?`

## ProgressSteps
Live steps for a multi-step action. The state must come from the real flow.
- `steps: { id: string; label: string; state: "pending" | "active" | "done" | "error"; detail? }[]`
- `label?` (list name), `testid?` (each step gets `<testid>-<id>`)
Active shows a spinning ring and a soft pulse; done draws a tick; error shows a cross. The list is a polite live region.

## TxLinkPill
An explorer link as a pill with an external-link mark. Opens NearBlocks in a new tab. Renders nothing without a target.
- `hash?: string` (transaction) or `account?: string` (address)
- `label?` (default: a short hash, or the full account), `testid?`

## Icon
Line icons (24 by 24, stroke only). Decorative unless a `label` is given.
- `name: IconName`, `size?` (default 20), `label?`, `className?`
- `IconName` values: home, swap, vault, key, activity, mint, lock, unlock, eye-off, check, x, alert, info, copy, external, arrow-right, arrow-up-right, arrow-down, arrow-up, arrow-swap, chevron-right, chevron-down, shield, search, plus, layers, maximize, tag, menu, more.
