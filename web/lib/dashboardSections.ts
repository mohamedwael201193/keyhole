/**
 * The sections of the personal dashboard. Everything a holder does lives under /dashboard, one section at a time, chosen by the
 * URL hash (/dashboard#swap). Pure helpers only: the Workspace component (components/dashboard/Workspace.tsx) draws them.
 * The old routes (/swap, /vault, /settle ...) still render the same views; links inside the app are rewritten with dashHref()
 * so ordinary work never leaves the dashboard.
 */
export const SECTION_IDS = ["overview", "swap", "vault", "keys", "pledge", "activity", "proof"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
/** Reached from a button inside Keys (Mint a key). It keeps Keys lit in the nav. */
export type HiddenSectionId = "mint";
export type AnySectionId = SectionId | HiddenSectionId;

export const SECTION_LABEL: Record<SectionId, string> = {
  overview: "Overview",
  swap: "Swap",
  vault: "Vault",
  keys: "Keys",
  pledge: "Pledge",
  activity: "Activity",
  proof: "My proof",
};

const ALL: readonly string[] = [...SECTION_IDS, "mint"];

export type ParsedHash = { section: AnySectionId; arg: string | null };

/** "#swap" → swap, "#proof/abc" → proof with arg abc, "" or anything unknown → overview. */
export function parseSectionHash(hash: string | null | undefined): ParsedHash {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return { section: "overview", arg: null };
  const slash = raw.indexOf("/");
  const id = (slash === -1 ? raw : raw.slice(0, slash)).toLowerCase();
  let arg: string | null = null;
  if (slash !== -1) { try { arg = decodeURIComponent(raw.slice(slash + 1)) || null; } catch { arg = null; } }
  // "#activity" has always been an anchor on the overview; it is now its own section.
  return ALL.includes(id) ? { section: id as AnySectionId, arg } : { section: "overview", arg: null };
}

/** The nav item a section lights up. Mint belongs to Keys. */
export const navSectionOf = (s: AnySectionId): SectionId => (s === "mint" ? "keys" : s);

export function sectionHref(id: AnySectionId, arg?: string | null): string {
  if (id === "overview" && !arg) return "/dashboard";
  return `/dashboard#${id}${arg ? `/${encodeURIComponent(arg)}` : ""}`;
}

/**
 * Where a redirect wallet sends the holder back. The hash is taken by the wallet's own answer (#signature=...), so the open
 * dashboard section travels as ?section=swap instead, and the Workspace reads it back. Any other page: the URL without its hash.
 */
export function walletCallbackUrl(href: string): string {
  try {
    const u = new URL(href);
    const { section } = parseSectionHash(u.hash);
    u.hash = "";
    if (u.pathname === "/dashboard" && section !== "overview") u.searchParams.set("section", section);
    return u.toString();
  } catch { return href.split("#")[0]; }
}

/** The section named by ?section=, for the return from a redirect wallet. "" when there is none. */
export function sectionFromSearch(search: string): string {
  const v = new URLSearchParams(search).get("section") ?? "";
  return parseSectionHash("#" + v).section === "overview" ? "" : v;
}

/** Old route → section. */
const ROUTE_SECTION: Record<string, AnySectionId> = {
  "/swap": "swap", "/vault": "vault", "/keys": "keys", "/gallery": "keys", "/mint": "mint", "/pledge": "pledge", "/settle": "activity",
};

/**
 * The in-dashboard address for an app path, so a link inside the app keeps the holder in /dashboard.
 * "/vault" → "/dashboard#vault", "/verify?call=ID" → "/dashboard#proof/ID". Any other path is returned unchanged.
 */
export function dashHref(path: string): string {
  const [base, query = ""] = path.split("?");
  const hit = ROUTE_SECTION[base];
  if (hit) return sectionHref(hit);
  if (base === "/verify") {
    const call = new URLSearchParams(query).get("call");
    return sectionHref("proof", call);
  }
  return path;
}
