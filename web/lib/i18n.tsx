"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

export const LOCALES = { en: { dir: "ltr", label: "English" }, ar: { dir: "rtl", label: "العربية" } } as const;
export type Locale = keyof typeof LOCALES;
type Dict = Record<string, unknown>;
const catalogs: Record<Locale, Dict> = { en, ar };

function lookup(d: Dict, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Dict)[k] : undefined), d);
}
export function translate(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  let v = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key);
  if (Array.isArray(v)) v = v[0];
  let s = typeof v === "string" ? v : key;
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replace(`{${k}}`, String(val));
  return s;
}
export function errorText(locale: Locale, code: string, vars?: Record<string, string | number>): [string, string] {
  const v = (lookup(catalogs[locale], `errors.${code}`) ?? lookup(catalogs.en, `errors.${code}`) ?? lookup(catalogs.en, "errors.unknown")) as string[];
  const sub = (s: string) => Object.entries(vars || {}).reduce((a, [k, x]) => a.replace(`{${k}}`, String(x)), s);
  return [sub(v[0]), sub(v[1])];
}

const Ctx = createContext<{ locale: Locale; setLocale: (l: Locale) => void; t: (k: string, v?: Record<string, string | number>) => string;
  fmtNum: (n: number, o?: Intl.NumberFormatOptions) => string; fmtUsd: (micro: number) => string } | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  useEffect(() => {
    const saved = localStorage.getItem("kh_locale") as Locale | null;
    if (saved && saved in LOCALES) setLocaleState(saved);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALES[locale].dir;
  }, [locale]);
  const setLocale = useCallback((l: Locale) => { localStorage.setItem("kh_locale", l); setLocaleState(l); }, []);
  const t = useCallback((k: string, v?: Record<string, string | number>) => translate(locale, k, v), [locale]);
  const fmtNum = useCallback((n: number, o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, o).format(n), [locale]);
  const fmtUsd = useCallback((micro: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(micro / 1e6), [locale]);
  return <Ctx.Provider value={{ locale, setLocale, t, fmtNum, fmtUsd }}>{children}</Ctx.Provider>;
}
export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("I18nProvider missing");
  return c;
}
