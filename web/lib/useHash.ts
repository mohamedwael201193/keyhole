"use client";
import { useEffect, useState } from "react";
import { sectionFromSearch } from "./dashboardSections";

const EVENT = "kh-hash";
let patched = false;

/**
 * pushState and replaceState do not fire hashchange, and Next's client links use pushState for a same-page hash link. This
 * wraps both once so every in-app navigation (a sidebar link, a button inside a section) reaches subscribers as one event.
 */
function patchHistory() {
  if (patched || typeof history === "undefined") return;
  patched = true;
  for (const m of ["pushState", "replaceState"] as const) {
    const orig = history[m].bind(history);
    history[m] = (...args: Parameters<History["pushState"]>) => {
      const r = orig(...args);
      try { dispatchEvent(new Event(EVENT)); } catch { /* no window */ }
      return r;
    };
  }
}

/** The current URL hash ("" or "#swap"), kept in step with in-app navigation, back and forward. "" on the server. */
export function useHash(): string {
  const [hash, setHash] = useState("");
  useEffect(() => {
    patchHistory();
    // A return from a redirect wallet carries the section as ?section= (the wallet owns the hash until it has been read).
    const read = () => { const q = sectionFromSearch(location.search); setHash(location.hash || (q ? `#${q}` : "")); };
    read();
    addEventListener("hashchange", read);
    addEventListener("popstate", read);
    addEventListener(EVENT, read);
    return () => { removeEventListener("hashchange", read); removeEventListener("popstate", read); removeEventListener(EVENT, read); };
  }, []);
  return hash;
}
