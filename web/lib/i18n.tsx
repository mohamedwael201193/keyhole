"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import en from "@/messages/en.json";
import { formatUsdMicro } from "./amount";

type Dict = Record<string, unknown>;

function lookup(d: Dict, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Dict)[k] : undefined), d);
}

export function translate(key: string, vars?: Record<string, string | number>): string {
  let v = lookup(en, key);
  if (Array.isArray(v)) v = v[0];
  let s = typeof v === "string" ? v : key;
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replace(`{${k}}`, String(val));
  return s;
}

export function errorText(code: string, vars?: Record<string, string | number>): [string, string] {
  const v = (lookup(en, `errors.${code}`) ?? lookup(en, "errors.unknown")) as string[];
  const sub = (s: string) => Object.entries(vars || {}).reduce((a, [k, x]) => a.replace(`{${k}}`, String(x)), s);
  return [sub(v[0]), sub(v[1])];
}

type Api = {
  t: (k: string, v?: Record<string, string | number>) => string;
  fmtNum: (n: number, o?: Intl.NumberFormatOptions) => string;
  fmtUsd: (micro: number) => string;
};

const Ctx = createContext<Api | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const api = useMemo<Api>(() => ({
    t: (k, v) => translate(k, v),
    fmtNum: (n, o) => new Intl.NumberFormat("en", o).format(n),
    fmtUsd: (micro) => formatUsdMicro(micro),
  }), []);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const c = useContext(Ctx);
  if (!c) throw new Error("I18nProvider missing");
  return c;
}
