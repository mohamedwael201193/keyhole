import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
const packages = (name: string): [string, {version: string}][] => Object.entries(lock.packages).filter(([path]) => path.endsWith(`/node_modules/${name}`) || path === `node_modules/${name}`) as [string, {version: string}][];
const require = createRequire(import.meta.url);
const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(resolve(root, file)).href);
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("reviewed wallet dependency migrations", () => {
  it("keeps all audited runtime leaf families on their fixed releases", () => {
    for (const name of ["zod", "lodash", "decode-uri-component", "query-string", "abitype"]) {
      const wanted = {zod:"4.6.6",lodash:"4.18.1","decode-uri-component":"0.5.1","query-string":"9.5.0",abitype:"1.3.0"}[name];
      expect(packages(name).length).toBeGreaterThan(0);
      for (const [,pkg] of packages(name)) expect(pkg.version).toBe(wanted);
    }
    for (const [,pkg] of packages("ws")) if (pkg.version.startsWith("8.")) expect(pkg.version).toBe("8.21.0");
    for (const [,pkg] of packages("nanoid")) if (pkg.version.startsWith("5.")) expect(pkg.version).toBe("5.1.16");
  });
  it("preserves every bs58 major's exact bytes, leading zeros and Unicode refusal", async () => {
    const bytes = Buffer.from([0, 0, ...Array.from({length:32}, (_,i)=>i * 7 % 256)]);
    const reference = (await load("node_modules/bs58/src/esm/index.js")).default.encode(bytes);
    for (const [path,pkg] of packages("bs58")) {
      const mod = require(resolve(root,path)); const codec = mod.default ?? mod;
      expect(codec.encode(bytes)).toBe(reference);
      expect(Buffer.from(codec.decode(reference))).toEqual(bytes);
      expect(() => codec.decode(reference + "１")).toThrow();
      expect(() => codec.decode("а" + reference.slice(1))).toThrow(); // Cyrillic, never an ASCII alias
      if (pkg.version.startsWith("4.")) expect(Buffer.isBuffer(codec.decode(reference))).toBe(true);
    }
  });
  it("loads every Reown v4 frame schema and validates provider collections and theme records", async () => {
    for (const [path] of packages("@reown/appkit-wallet")) {
      const s = await load(`${path}/dist/esm/src/W3mFrameSchema.js`);
      const user = {address:"0x123",chainId:1,accounts:[{address:"0x123",type:"eoa"}]};
      expect(s.FrameGetUserResponse.safeParse(user).success).toBe(true);
      expect(s.FrameGetUserResponse.safeParse({...user,accounts:[{address:42,type:"eoa"}]}).success).toBe(false);
      expect(s.AppSyncThemeRequest.parse({themeVariables:{"--w3m-accent":"#fff",radius:2}}).themeVariables.radius).toBe(2);
      expect(s.AppSyncThemeRequest.safeParse({themeVariables:{radius:[]}}).success).toBe(false);
      expect(s.RpcPersonalSignRequest.safeParse({method:"personal_sign",params:["0x00","0x123"]}).success).toBe(true);
      expect(s.RpcPersonalSignRequest.safeParse({method:"eth_sendTransaction",params:[]}).success).toBe(false);
    }
  });
  it("migrates x402's single-argument records in both ESM and CJS without loosening payment validation", async () => {
    const [path] = packages("x402")[0];
    const esm = await load(`${path}/dist/esm/types/index.mjs`);
    const cjs = require(resolve(root,path,"dist/cjs/types/index.js"));
    const payment = {scheme:"exact",network:"base",maxAmountRequired:"10000",resource:"https://example.test/pay",description:"test",mimeType:"application/json",payTo:"0x1111111111111111111111111111111111111111",maxTimeoutSeconds:60,asset:"0x2222222222222222222222222222222222222222",outputSchema:{nested:{ok:true}},extra:{arbitrary:[1,"a"]}};
    for (const s of [esm,cjs]) {
      expect(s.PaymentRequirementsSchema.parse(payment)).toEqual(payment);
      expect(s.PaymentRequirementsSchema.safeParse({...payment,maxAmountRequired:"not-an-integer"}).success).toBe(false);
      expect(s.PaymentRequirementsSchema.safeParse({...payment,payTo:"wrong"}).success).toBe(false);
      expect(s.PaymentRequirementsSchema.safeParse({...payment,extra:[]}).success).toBe(false);
    }
  });
  it("opens Meteor's real ESM and CJS signature popups using the new default decoder export", async () => {
    vi.useFakeTimers();
    vi.spyOn(console,"log").mockImplementation(()=>{});
    const [path] = packages("@meteorwallet/sdk")[0];
    const esm = await load(`${path}/dist/index.js`);
    const cjs = require(resolve(root,path,"dist/index.cjs"));
    for (const mod of [esm,cjs]) {
      const open = vi.fn((url: string)=>{ void url; return {postMessage:vi.fn(),focus:vi.fn(),closed:false}; });
      vi.stubGlobal("window",{location:{href:"https://example.test/return?a=one two&b=+"},top:{outerHeight:900,outerWidth:1440,screenY:0,screenX:0},open,addEventListener:vi.fn(),removeEventListener:vi.fn(),localStorage:{getItem:()=>null,setItem:vi.fn(),removeItem:vi.fn()}});
      const wallet = new mod.MeteorWallet({networkId:"testnet",keyStore:{getKey:vi.fn(),setKey:vi.fn()}});
      void wallet.signMessage({message:"KEYHOLE regression",nonce:Buffer.alloc(32),recipient:"keyhole",accountId:"alice.testnet"}).catch(()=>{});
      await vi.advanceTimersByTimeAsync(100);
      expect(open).toHaveBeenCalledTimes(1);
      const url = new URL(open.mock.calls[0][0]);
      expect(url.pathname).toContain("/connect/testnet/");
      expect(url.searchParams.get("connectionUid")).toMatch(/^[A-Za-z0-9_-]{21}$/);
      expect(url.searchParams.get("pageUri")).toBe(encodeURIComponent("https://example.test/return?a=one two&b=+"));
      vi.clearAllTimers();
    }
  });
  it("keeps all old and current viem ABI encoders compatible with the dual-zod ABI release", async () => {
    const abi = [{type:"function",name:"transfer",stateMutability:"nonpayable",inputs:[{name:"to",type:"address"},{name:"amount",type:"uint256"}],outputs:[{type:"bool"}]}];
    const address = "0x1111111111111111111111111111111111111111";
    let expected: string | undefined;
    for (const [path] of packages("viem")) {
      const {encodeFunctionData,decodeFunctionData} = await load(`${path}/_esm/index.js`);
      const encoded = encodeFunctionData({abi,functionName:"transfer",args:[address,123n]});
      expected ??= encoded;
      expect(encoded).toBe(expected);
      expect(decodeFunctionData({abi,data:encoded}).args).toEqual([address,123n]);
    }
  });
  it("retains patched lodash modular helpers and safe template imports", () => {
    expect(require("lodash/fromPairs")([["a",1]])).toEqual({a:1});
    expect(require("lodash/template")("hello <%= name %>")({name:"keyhole"})).toBe("hello keyhole");
    expect(() => require("lodash/template")("ok",{imports:{"x);throw new Error('injected');//":1}})).toThrow("Invalid `imports` option");
  });
});
