import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { networks } from "@web3icons/common/metadata/networks";
import { tokens } from "@web3icons/common/metadata/tokens";
import { TokenMark, ChainMark } from "@/components/TokenMark";
import { popularOptions, type TokenOption } from "@/components/ui/token-select";
import {
  NETWORK_MARK_FILES, WEB3ICONS_CDN, buildTokenMarkIndex, chainMarkCacheKey, firstLoading, localTokenMarkUrl, markCacheKey, networkMarkUrl,
  probeImage, readMarkCache, resolveTokenMark, tokenGlyph, tokenMarkCandidates, writeMarkCache, type MetaToken, type TokenMarkIndex,
} from "@/lib/tokenMarks";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const USDC_NEAR = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_ETH = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

/** A small index in the same shape as the real metadata, so the order is tested without loading 1,851 entries. */
const fake: MetaToken[] = [
  { filePath: "token:USDC", symbol: "USDC", marketCapRank: 6, addresses: { ethereum: "0xA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48" }, variants: ["branded", "mono"] },
  { filePath: "token:USDC", symbol: "USDC", marketCapRank: 9000, addresses: { ethereum: "0x1111111111111111111111111111111111111111" }, variants: ["branded"] },
  { filePath: "token:SOLX", symbol: "SOLX", marketCapRank: null, addresses: { solana: "So11111111111111111111111111111111111111112" }, variants: ["mono"] },
  { filePath: "token:NEAR", symbol: "near", marketCapRank: 40, addresses: {}, variants: ["branded"] },
];
const index = buildTokenMarkIndex(fake);

describe("network marks: the 1Click chain map", () => {
  it("every mapped chain is a branded network file in @web3icons/common 0.11.53", () => {
    for (const [chain, file] of Object.entries(NETWORK_MARK_FILES)) {
      const hit = networks.find((n) => n.filePath === `network:${file}`);
      expect(hit, `${chain} -> ${file}`).toBeDefined();
      expect(hit?.variants, `${chain} -> ${file}`).toContain("branded");
    }
  });

  it("maps 28 of the 39 chains the live 1Click list has; the other 11 get a monogram badge", () => {
    expect(Object.keys(NETWORK_MARK_FILES)).toHaveLength(28);
    for (const chain of ["miden", "hypercore", "aleo", "fogo", "zec", "qtc", "prl", "doge", "bch", "dash", "adi"]) {
      expect(networkMarkUrl(chain), chain).toBeNull();
    }
  });

  it("builds the CDN URL for a mapped chain and nothing for unknown, empty or prototype keys", () => {
    expect(networkMarkUrl("eth")).toBe(`${WEB3ICONS_CDN}/networks/branded/ethereum.svg`);
    expect(networkMarkUrl("near")).toBe(`${WEB3ICONS_CDN}/networks/branded/near-protocol.svg`);
    expect(networkMarkUrl("hood")).toBe(`${WEB3ICONS_CDN}/networks/branded/robinhood.svg`);
    expect(networkMarkUrl("")).toBeNull();
    expect(networkMarkUrl(null)).toBeNull();
    expect(networkMarkUrl("constructor")).toBeNull();
    expect(networkMarkUrl("__proto__")).toBeNull();
  });
});

describe("token candidates", () => {
  it("the self-hosted mark comes first for a symbol it covers, then the branded file, CoinCap, DexScreener, spothq last", () => {
    const urls = tokenMarkCandidates({ symbol: "USDC", contract: USDC_ETH, chain: "eth" }, index);
    expect(urls).toEqual([
      "/tokens/usdc.svg",
      `${WEB3ICONS_CDN}/tokens/branded/USDC.svg`,
      "https://assets.coincap.io/assets/icons/usdc@2x.png",
      `https://dd.dexscreener.com/ds-data/tokens/ethereum/${USDC_ETH}.png`,
      "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/usdc.svg",
    ]);
  });

  it("without the metadata index the web3icons branded file is left out, the other sources stay", () => {
    expect(tokenMarkCandidates({ symbol: "USDC" }, null)).toEqual([
      "/tokens/usdc.svg",
      "https://assets.coincap.io/assets/icons/usdc@2x.png",
      "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/svg/color/usdc.svg",
    ]);
  });

  it("finds the branded file by contract first, then by symbol; the best-ranked symbol wins", () => {
    const byContract = tokenMarkCandidates({ symbol: "USDC", contract: "0x1111111111111111111111111111111111111111", chain: "eth" }, index);
    expect(byContract).toContain(`${WEB3ICONS_CDN}/tokens/branded/USDC.svg`);
    expect(index.byAddress.get("0x1111111111111111111111111111111111111111")).toBe("USDC");
    const bySymbol = tokenMarkCandidates({ symbol: "usdc", contract: "0xdeadbeef" }, index);
    expect(bySymbol).toContain(`${WEB3ICONS_CDN}/tokens/branded/USDC.svg`);
    expect(index.bySymbol.get("usdc")).toBe("USDC");
  });

  it("a Solana contract on sol gets the Solana DexScreener image, and an EVM address on sol gets none", () => {
    const sol = "So11111111111111111111111111111111111111112";
    expect(tokenMarkCandidates({ symbol: "SOLX", contract: sol, chain: "sol" }, index)).toContain(`https://dd.dexscreener.com/ds-data/tokens/solana/${sol}.png`);
    expect(tokenMarkCandidates({ symbol: "SOLX", contract: USDC_ETH, chain: "sol" }, index).some((u) => u.includes("dexscreener"))).toBe(false);
  });

  it("a chain with no DexScreener slug adds no DexScreener URL; with no chain the address format decides", () => {
    expect(tokenMarkCandidates({ symbol: "ARB", contract: USDC_ETH, chain: "arb" }).some((u) => u.includes("dexscreener"))).toBe(false);
    const any = tokenMarkCandidates({ symbol: "XYZ", contract: USDC_ETH }).filter((u) => u.includes("dexscreener"));
    expect(any).toEqual(["ethereum", "base", "bsc"].map((d) => `https://dd.dexscreener.com/ds-data/tokens/${d}/${USDC_ETH}.png`));
  });

  it("CJK and unusual tickers never reach a Latin-only source", () => {
    expect(tokenMarkCandidates({ symbol: "牛来" }, index)).toEqual([]);
    expect(tokenMarkCandidates({ symbol: "币安人生" }, index)).toEqual([]);
  });

  it("the NEAR asset id picks the NEAR mark through the self-hosted map", () => {
    expect(localTokenMarkUrl({ assetId: USDC_NEAR, symbol: "USDC" })).toBe("/tokens/usdc.svg");
    expect(localTokenMarkUrl({ assetId: "nep141:wrap.near", symbol: "wNEAR" })).toBe("/tokens/near.svg");
    expect(localTokenMarkUrl({ symbol: "ZZZ" })).toBeNull();
  });

  it("returns no duplicate URLs", () => {
    const urls = tokenMarkCandidates({ symbol: "USDC" }, buildTokenMarkIndex([...fake, ...fake]));
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("the real @web3icons/common metadata resolves USDC and ETH on Ethereum by contract", () => {
    const real = buildTokenMarkIndex(tokens as unknown as MetaToken[]);
    expect(tokenMarkCandidates({ symbol: "USDC", contract: USDC_ETH, chain: "eth" }, real)).toContain(`${WEB3ICONS_CDN}/tokens/branded/USDC.svg`);
    expect(tokenMarkCandidates({ symbol: "ETH", chain: "base" }, real)).toContain(`${WEB3ICONS_CDN}/tokens/branded/ETH.svg`);
  });
});

describe("the metadata index", () => {
  it("keeps branded entries only, lower-cases EVM addresses and keeps Solana addresses exact", () => {
    expect(index.bySymbol.get("solx")).toBeUndefined();
    expect(index.byAddress.get(USDC_ETH)).toBe("USDC");
    expect(index.byAddress.get("So11111111111111111111111111111111111111112")).toBeUndefined();
    expect(index.byAddress.get("0x1111111111111111111111111111111111111111")).toBe("USDC");
  });

  it("a symbol match picks the lowest market cap rank, so a look-alike never takes the real mark", () => {
    const rigged = buildTokenMarkIndex([
      { filePath: "token:FAKE", symbol: "USDT", marketCapRank: 9999, variants: ["branded"] },
      { filePath: "token:TETHER", symbol: "USDT", marketCapRank: 3, variants: ["branded"] },
    ]);
    expect(rigged.bySymbol.get("usdt")).toBe("TETHER");
  });
});

describe("glyphs and cache keys", () => {
  it("two characters, upper-cased for Latin; CJK kept exactly; empty becomes ?", () => {
    expect(tokenGlyph("wNEAR")).toBe("WN");
    expect(tokenGlyph("USDC")).toBe("US");
    expect(tokenGlyph("1inch")).toBe("1I");
    expect(tokenGlyph("牛来")).toBe("牛来");
    expect(tokenGlyph("币安人生")).toBe("币安");
    expect(tokenGlyph("")).toBe("?");
    expect(tokenGlyph("$$")).toBe("?");
    expect(tokenGlyph(undefined)).toBe("?");
  });

  it("cache keys follow icon:{symbol}:{contract}, and chain marks have their own", () => {
    expect(markCacheKey("USDC", USDC_ETH)).toBe(`icon:USDC:${USDC_ETH}`);
    expect(markCacheKey("USDC")).toBe("icon:USDC:");
    expect(chainMarkCacheKey("ETH")).toBe("chainmark:eth");
  });
});

describe("probing", () => {
  const realImage = (globalThis as { Image?: unknown }).Image;
  const realStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage;
  afterEach(() => {
    if (realImage === undefined) delete (globalThis as { Image?: unknown }).Image; else (globalThis as { Image?: unknown }).Image = realImage;
    if (realStorage === undefined) delete (globalThis as { sessionStorage?: unknown }).sessionStorage; else (globalThis as { sessionStorage?: unknown }).sessionStorage = realStorage;
  });

  /** A stand-in Image: a load resolves on a microtask, true for the URLs `ok` accepts, and no request is made. */
  function mockImage(ok: (url: string) => boolean, log: string[] = []) {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(url: string) {
        log.push(url);
        const pass = ok(url);
        queueMicrotask(() => (pass ? this.onload?.() : this.onerror?.()));
      }
    }
    (globalThis as { Image?: unknown }).Image = FakeImage;
  }

  it("probeImage resolves true for a load and false for an error, off the DOM", async () => {
    mockImage((u) => u.includes("ok"));
    expect(await probeImage("https://x.test/ok.png")).toBe(true);
    expect(await probeImage("https://x.test/missing.png")).toBe(false);
  });

  it("probeImage resolves false when there is no Image at all (server, tests)", async () => {
    delete (globalThis as { Image?: unknown }).Image;
    expect(await probeImage("https://x.test/ok.png")).toBe(false);
  });

  it("firstLoading tries the URLs in order and stops at the first that loads", async () => {
    const tried: string[] = [];
    const probe = async (u: string) => { tried.push(u); return u.endsWith("c"); };
    expect(await firstLoading(["a", "b", "c", "d"], probe)).toBe("c");
    expect(tried).toEqual(["a", "b", "c"]);
    expect(await firstLoading(["a"], async () => false)).toBeNull();
  });

  it("resolveTokenMark probes the self-hosted mark first and loads the index only when it misses", async () => {
    let loaded = 0;
    const idx = async () => { loaded += 1; return index; };
    const hit = await resolveTokenMark({ symbol: "USDC" }, { probe: async (u) => u === "/tokens/usdc.svg", index: idx });
    expect(hit).toBe("/tokens/usdc.svg");
    expect(loaded).toBe(0);
    const branded = `${WEB3ICONS_CDN}/tokens/branded/USDC.svg`;
    const miss = await resolveTokenMark({ symbol: "USDC", contract: USDC_ETH, chain: "eth" }, { probe: async (u) => u === branded, index: idx });
    expect(miss).toBe(branded);
    expect(loaded).toBe(1);
    expect(await resolveTokenMark({ symbol: "QQQ" }, { probe: async () => false, index: async () => null })).toBeNull();
  });

  it("probing through the mock Image asks the browser for each candidate once, in order", async () => {
    const log: string[] = [];
    mockImage((u) => u.endsWith("usdc.svg"), log);
    const hit = await resolveTokenMark({ symbol: "USDC" }, { probe: probeImage, index: async () => null });
    expect(hit).toBe("/tokens/usdc.svg");
    expect(log).toEqual(["/tokens/usdc.svg"]);
  });

  it("sessionStorage holds the winner or a miss; storage errors read as never resolved", () => {
    const store = new Map<string, string>();
    (globalThis as { sessionStorage?: unknown }).sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };
    expect(readMarkCache("icon:USDC:")).toBeUndefined();
    writeMarkCache("icon:USDC:", "/tokens/usdc.svg");
    writeMarkCache("icon:QQQ:", "");
    expect(readMarkCache("icon:USDC:")).toBe("/tokens/usdc.svg");
    expect(readMarkCache("icon:QQQ:")).toBe("");
    (globalThis as { sessionStorage?: unknown }).sessionStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readMarkCache("icon:USDC:")).toBeUndefined();
    expect(() => writeMarkCache("icon:USDC:", "x")).not.toThrow();
  });
});

describe("marks render: monogram first, badge from the chain", () => {
  it("a token mark is a monogram on first paint, with the chain badge at 24 and 32 px and none at 20", () => {
    const m32 = html(createElement(TokenMark, { symbol: "USDC", chain: "near", assetId: USDC_NEAR, size: 32 }));
    expect(m32).toContain('data-mark="monogram"');
    expect(m32).toContain('kh-tmark-glyph">US<');
    expect(m32).toContain('data-net="near"');
    expect(m32).toContain("kh-netmark-glyph");
    expect(m32).not.toContain("<img");
    expect(html(createElement(TokenMark, { symbol: "USDC", chain: "near", size: 20 }))).not.toContain("kh-netmark");
    expect(html(createElement(TokenMark, { symbol: "USDC", size: 24 }))).not.toContain("kh-netmark");
  });

  it("a standalone mark has a role and a label; beside text it is hidden from assistive tech", () => {
    expect(html(createElement(TokenMark, { symbol: "USDC", label: "USD Coin", size: 40 }))).toContain('aria-label="USD Coin"');
    expect(html(createElement(TokenMark, { symbol: "USDC", size: 40 }))).toContain('aria-hidden="true"');
  });

  it("an unmapped chain shows a monogram badge, and the badge stays decorative", () => {
    const m = html(createElement(ChainMark, { chain: "miden", size: 16 }));
    expect(m).toContain('data-mark="monogram"');
    expect(m).toContain('aria-hidden="true"');
  });
});

describe("picker helpers", () => {
  const opt = (id: string, symbol: string, chain: string): TokenOption => ({ id, symbol, name: symbol, assetId: id, chain });

  it("the popular row has one token per symbol, on the best chain, and only symbols the list has", () => {
    const list = [
      opt("base-usdc", "USDC", "base"),
      opt(USDC_NEAR, "USDC", "near"),
      opt("eth-usdc", "USDC", "eth"),
      opt("wrap", "wNEAR", "near"),
      opt("eth", "ETH", "eth"),
      opt("pepe", "PEPE", "eth"),
    ];
    expect(popularOptions(list).map((o) => `${o.symbol}@${o.chain}`)).toEqual(["USDC@near", "wNEAR@near", "ETH@eth"]);
    expect(popularOptions([])).toEqual([]);
  });
});

describe("swap screen rebuild (source contract)", () => {
  const view = src("../app/swap/view.tsx");
  const css = src("../app/swap/swap.css");

  it("quote requests are debounced at 500 ms, not 800", () => {
    expect(view).toContain("}, 500);");
    expect(view).not.toContain("}, 800);");
  });

  it("the card says the slippage is fixed, because the quote path takes no slippage parameter", () => {
    expect(view).toContain("Max slippage 1%, fixed");
    expect(view).toContain("1%, fixed by the vault");
  });

  it("the picker is a full-screen sheet on phones and a 440 px dialog above that", () => {
    expect(src("../components/ui/token-select.tsx")).toContain('variant="sheet"');
    const ui = src("../app/ui.css");
    expect(ui).toContain("width: min(440px, 100%)");
    expect(ui).toContain("height: 100dvh");
  });

  it("uses tokens only: no literal colours in the swap stylesheet", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("!important");
  });
});
