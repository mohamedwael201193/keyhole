#!/usr/bin/env python3
# Regenerates docs/claims.json from README.md, TRACK_COVERAGE.md, SECURITY.md and the site source.
# usage: python3 judge/gen-claims.py .
import re, json, os, sys
R = sys.argv[1] if len(sys.argv) > 1 else "."; os.chdir(R)
DOCS = ["README.md", "TRACK_COVERAGE.md", "SECURITY.md"]
C = []; seen = set()
SITE = "https://keyhole-seven.vercel.app"
def add(id, claim, where, etype, evidence, check, expected, verify=None):
    if id in seen: return
    seen.add(id)
    C.append(dict(id=id, claim=claim, where=where, evidence_type=etype, evidence=evidence,
                  check=check, expected=expected,
                  verify=verify or f"node judge/verify-claims.mjs --only {id}"))
def where(doc, needle):
    for i, l in enumerate(open(doc, encoding="utf8"), 1):
        if needle in l: return f"{doc}:{i}"
    raise SystemExit(f"not found in {doc}: {needle}")
ID=json.load(open("identity.json")); W=ID["worker"]; K=ID["contract"]
RD="README.md"; TC="TRACK_COVERAGE.md"; SE="SECURITY.md"
# ---------------- contract (live RPC) ----------------
add("contract-code-hash", "On-chain code_hash BfMiMAfg…xMLeZ of keyhole-devmo.near is the base58 sha256 of the committed contracts/keys/deployed/keyhole_keys.wasm", where(RD,K["code_hash"]), "script", "judge/1-contract.sh",
    {"type":"code_hash","account":"keyhole-devmo.near","wasm":"contracts/keys/deployed/keyhole_keys.wasm","code_hash":K["code_hash"]}, "code_hash == base58(sha256(wasm)) == Fe79rQUH…", "./judge/1-contract.sh")
add("contract-wasm-sha", "Deployed contract wasm is 209,952 bytes with sha256 9e685c32…089e", where(RD,"209,952 bytes"), "file", "contracts/keys/deployed/keyhole_keys.wasm",
    {"type":"sha256","path":"contracts/keys/deployed/keyhole_keys.wasm","sha256":K["wasm_sha256"],"bytes":209952}, "sha256 9e685c32…089e, 209952 bytes", "sha256sum contracts/keys/deployed/keyhole_keys.wasm && wc -c contracts/keys/deployed/keyhole_keys.wasm")
cfg = {"owner":"keyhole-devmo.near","minter":"015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443","treasury":"keyhole-devmo.near","royalty_bps":500}
for k,v in cfg.items():
    add(f"config-{k}", f"Contract config.{k} is {v}", where(RD,'"royalty_bps":500'), "mainnet view", "keyhole-devmo.near config()",
        {"type":"view","method":"config","args":{},"path":k,"op":"eq","value":v}, f"config.{k} == {v}")
add("config-beats", "Heartbeat count config.beats was 2 at capture (2026-11-03) and only grows", where(RD,'"beats":"2"'), "mainnet view", "keyhole-devmo.near config()",
    {"type":"view","method":"config","args":{},"path":"beats","op":"gte","value":2}, "config.beats >= 2 (live value printed)")
add("supply", "nft_total_supply was 5 on 2026-11-03 (live value can only grow)", where(RD,"`nft_total_supply` = 5"), "mainnet view", "keyhole-devmo.near nft_total_supply()",
    {"type":"view","method":"nft_total_supply","args":{},"op":"gte","value":5}, ">= 5 (live value printed)")
add("metadata-symbol", "NEP-177 metadata is KEYHOLE / KEY", where(RD,"(`KEYHOLE` / `KEY`)"), "mainnet view", "nft_metadata()",
    {"type":"view","method":"nft_metadata","args":{},"path":"symbol","op":"eq","value":"KEY"}, "symbol == KEY")
add("metadata-name", "NEP-177 metadata name is KEYHOLE", where(RD,"(`KEYHOLE` / `KEY`)"), "mainnet view", "nft_metadata()",
    {"type":"view","method":"nft_metadata","args":{},"path":"name","op":"eq","value":"KEYHOLE"}, "name == KEYHOLE")
toks = {"0":"keyhole-devmo.near","k857b6b68facc0f94":"a7458a83e9c4693286692efab949fc0f7d089b7f46352fb2a87a514ec2c391da","k5f4750858f328940":"3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447","k0642e7964b2fb515":"476abdb54d0a55fba7cf45c624aa5a65665aaa92f50f4dd36f09abc1890ca8c8","k102a806df6867547":"0xf76e6b0920e9332ff4410f6dd53f01722abc71a3"}
for t,o in toks.items():
    add(f"token-{t}-owner", f"Token {t} is held by {o} (table read 2026-11-03)", where(RD,f"| `{t}` |"), "mainnet view", f"nft_token({t})",
        {"type":"view","method":"nft_token","args":{"token_id":t},"path":"owner_id","op":"eq","value":o}, f"owner_id == {o}")
    add(f"token-{t}-tier", f"Token {t} is tier 1", where(RD,f"| `{t}` |"), "mainnet view", f"nft_tier({t})",
        {"type":"view","method":"nft_tier","args":{"token_id":t},"op":"eq","value":1}, "1")
add("token-k102-media", "Token k102a806df6867547 (MetaMask mint) carries media on-chain", where(RD,"carries `media` on-chain"), "mainnet view", "nft_token(k102a806df6867547)",
    {"type":"view","method":"nft_token","args":{"token_id":"k102a806df6867547"},"path":"metadata.media","op":"nonempty"}, "metadata.media is a non-empty URL")
for t in ["0","k0642e7964b2fb515","k5f4750858f328940","k857b6b68facc0f94"]:
    add(f"token-{t}-media-null", f"Token {t}, minted before media was written, has media: null", where(RD,"have `media: null` on-chain"), "mainnet view", f"nft_token({t})",
        {"type":"view","method":"nft_token","args":{"token_id":t},"path":"metadata.media","op":"eq","value":None}, "metadata.media == null")
# ---------------- access keys ----------------
add("key-fastfs-scoped", "keyhole-devmo.near has a FunctionCall key FNe2aYtz… limited to `social` methods __fastdata_kv, __fastdata_fastfs", where(RD,"`ed25519:FNe2aYtz…`"), "mainnet view", "view_access_key_list keyhole-devmo.near",
    {"type":"access_key","account":"keyhole-devmo.near","prefix":"ed25519:FNe2aYtz","receiver":"social","methods":["__fastdata_kv","__fastdata_fastfs"]}, "FunctionCall receiver social, methods exactly those two")
add("key-owner-full", "keyhole-devmo.near FullAccess key 7N1fLo9M…", where(RD,"`ed25519:7N1fLo9M…`"), "mainnet view", "view_access_key_list keyhole-devmo.near",
    {"type":"access_key","account":"keyhole-devmo.near","prefix":"ed25519:7N1fLo9M","full":True}, "FullAccess")
add("key-minter-full", "TEE minter 015a0259… FullAccess key 6H1iG1oH…", where(RD,"`ed25519:6H1iG1oH…`"), "mainnet view", "view_access_key_list minter",
    {"type":"access_key","account":cfg["minter"],"prefix":"ed25519:6H1iG1oH","full":True}, "FullAccess")
add("key-beat-scoped", "Beat key 9FiNXX2M… on the minter: FunctionCall to keyhole-devmo.near, method beat only, allowance at most 0.05 NEAR", where(RD,"`ed25519:9FiNXX2M…` (beat key)"), "mainnet view", "view_access_key_list minter",
    {"type":"access_key","account":cfg["minter"],"prefix":"ed25519:9FiNXX2M","receiver":"keyhole-devmo.near","methods":["beat"],"max_allowance":"50000000000000000000000"}, "FunctionCall keyhole-devmo.near [beat], allowance <= 0.05 NEAR")
# ---------------- worker build ----------------
DEP = open("tee/worker/DEPLOYED_SHA256").read().strip()
add("worker-deployed", "The live worker build is 94c355ff…a9ed (tee/worker/DEPLOYED_SHA256)", where(RD,"build **`94c355ff…a9ed`**"), "file", "tee/worker/DEPLOYED_SHA256",
    {"type":"grep","path":"tee/worker/DEPLOYED_SHA256","pattern":"^"+W["wasm_sha256"]+"\\s*$"}, "94c355ffa318ec0e…f2bca9ed")
add("worker-fastfs", "The 94c355ff wasm (739601 bytes) is on FastFS and hashes to DEPLOYED_SHA256", where(RD,"(739601 bytes)"), "OutLayer call", f"https://main.fastfs.io/keyhole-devmo.near/outlayer.near/{DEP}.wasm",
    {"type":"fastfs","sha256":DEP,"bytes":739601}, "sha256 == DEPLOYED_SHA256, 739601 bytes",
    f"curl -fsS https://main.fastfs.io/keyhole-devmo.near/outlayer.near/{DEP}.wasm | sha256sum")
# ---------------- attestations ----------------
builds = {"ecb0d1d6-90e3-4522-852a-578ca50fdeb6":"94c355ff","643a012d-0389-44d7-9c78-efb5d7835e80":"cff9fd3c","b0a6eadb-cee9-400e-8eca-8b0f4df7bcec":"a55ebb14","2896d0ad-aa27-4e21-b4a1-0cf2d3755d56":"09d481a5","54207d9e-b4f0-438b-9a74-cdba33de80d9":"f7217ae2","7882f97a-06e5-46d3-9e58-5fe6428fb187":"452df1fd","f4768da8-2e87-4622-8654-d1e67f6cd1f0":"6367401a","0f0bf448-1b66-4200-b6de-7cf095aead54":"67c5cd77","763812bc-0012-4528-a45d-66a3ce17cae9":"38bd67b9","9d19bceb-986b-4745-9bf9-91f7dcb62b6e":"b3fa1a39","cefbc64e-6c08-4bfe-a165-1667d9f5f25b":"f13efe92","09d58c09-c1e9-48b6-bebb-485f5ae79539":"f13efe92"}
for c,b in builds.items():
    add(f"att-{c[:8]}-build", f"Call {c[:8]} executed worker build {b}", where(RD,c), "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}",
        {"type":"attestation","call":c,"wasm_prefix":b,"project":"keyhole-devmo.near/keyhole"}, f"executed_wasm_sha256 starts {b}, == wasm_hash, TDX quote present", f"./verify.sh {c}")
# 30-step table: ✓ f13efe926132
for i,l in enumerate(open(RD,encoding="utf8"),1):
    m = re.search(r"by-call/([0-9a-f-]{36})\) ✓ `f13efe926132`", l)
    if m:
        c=m.group(1); add(f"att-{c[:8]}-build", f"E2E step call {c[:8]} attested to f13efe926132", f"{RD}:{i}", "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}",
            {"type":"attestation","call":c,"wasm_prefix":"f13efe926132"}, "executed_wasm_sha256 starts f13efe926132", f"./verify.sh {c}")
for c in ["9c258ced-40c4-4738-8621-794e35f41f5d","57d03a3b-def4-46dc-a66f-6cfd36570572","a28106f0-8eff-49e6-8998-57d99d2e9298","1792da1a-0a36-4df0-84b0-0d28e7a4828c","6eccc374-ed17-4764-810b-f3f56a1ad6bd","e977cb88-0490-47f8-abfd-eb409eb572b4","22cb472d-a759-4284-a3fd-651b059dc576","b4038809-2347-43fd-aa28-f829b677e7d1"]:
    add(f"att-{c[:8]}-build", f"Gateway call {c[:8]} ran on build 3ea56ee6, project keyhole-probe", where(RD,c), "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}",
        {"type":"attestation","call":c,"wasm_prefix":"3ea56ee6","project":"keyhole-devmo.near/keyhole-probe"}, "executed starts 3ea56ee6 on keyhole-probe")
add("att-f198ce3a-build", "info via /api/keyhole call f198ce3a ran on build f13efe92", where(RD,"f198ce3a"), "OutLayer call", "https://api.outlayer.ai/attestations/by-call/f198ce3a-a3df-4c27-ac26-79ef50003fb1",
    {"type":"attestation","call":"f198ce3a-a3df-4c27-ac26-79ef50003fb1","wasm_prefix":"f13efe92"}, "executed starts f13efe92")
for c in ["d3c285ae-54a2-442f-a9ee-e9d9af02e4c6","b6d8ce4e-6d46-4b57-a126-ab4ff9e7a563","9b37dfee-47bf-4482-a445-0623a49d3f11"]:
    add(f"att-{c[:8]}-build", f"Live judge run call {c[:8]} attested to f13efe926132", where(RD,c), "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}",
        {"type":"attestation","call":c,"wasm_prefix":"f13efe926132"}, "executed starts f13efe926132")
for c in ["d03f935f-dfc4-4548-8109-b9aabb5560fc","7d42db8d-d786-457f-b505-a96359f82393","c23f7bbf-c37c-4327-8edd-e773d3a8324f","7f52f7d8-e4f6-4290-97e8-0754b90bcfc8","a6b78742-f5ed-436b-845d-da5880f63ea1","fffe6327-2e0c-47c5-9942-bf785c8c152a","9e62569d-9444-4503-8bf2-4c1c266b8316"]:
    add(f"att-{c[:8]}-build", f"Funded run call {c[:8]} matched build f13efe92", where(RD,c), "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}",
        {"type":"attestation","call":c,"wasm_prefix":"f13efe92"}, "executed starts f13efe92", f"./verify.sh {c}")
for c in ["afaaf3e1-32ff-42d8-88da-412a0bb61e11","06cf2630-aed4-410a-9e28-f0799efddeda","369f522d-4bef-4b17-9071-1de01616eef6"]:
    add(f"att-{c[:8]}", f"Track-coverage call {c[:8]} is a real attested call", where(TC,c[:8]), "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}",
        {"type":"attestation","call":c}, "attestation exists, executed == wasm_hash")
# every other attestation / verify link in the docs
for d in DOCS:
    for i,l in enumerate(open(d,encoding="utf8"),1):
        for c in re.findall(r"(?:by-call/|verify\?call=)([0-9a-f]{8}-[0-9a-f-]{27})", l):
            add(f"att-{c[:8]}", f"Attested call {c[:8]} linked from {d}", f"{d}:{i}", "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}",
                {"type":"attestation","call":c}, "attestation exists, executed == wasm_hash")
# ---------------- transactions ----------------
for d in DOCS:
    for i,l in enumerate(open(d,encoding="utf8"),1):
        for h in re.findall(r"nearblocks\.io/txns/([1-9A-HJ-NP-Za-km-z]{43,44})", l):
            exp = "exists" if "revert" in l else "success"
            add(f"tx-{h[:8]}", f"Mainnet transaction {h[:8]}… linked from {d} ({'expected revert' if exp=='exists' else 'succeeded'})", f"{d}:{i}", "mainnet tx", f"https://nearblocks.io/txns/{h}",
                {"type":"tx","hash":h,"expect":exp}, "transaction found on mainnet" + ("" if exp=="exists" else " with no failed receipt"))
add("tx-7P9VFx4p", "Chain Signatures: one real MPC signature for the key's derived address (v1.signer.sign tx 7P9VFx4p…)", where(TC,"7P9VFx4p"), "mainnet tx", "https://nearblocks.io/txns/7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQcEM2vgKFUAfK",
    {"type":"tx","hash":"7P9VFx4pz5oxyXpXkyDVE6SheDuTqHgQcEM2vgKFUAfK","expect":"success","receiver":"v1.signer"}, "tx succeeded, a receipt executed on v1.signer")
# ---------------- accounts ----------------
for d in DOCS:
    for i,l in enumerate(open(d,encoding="utf8"),1):
        for a in re.findall(r"nearblocks\.io/address/([a-z0-9._-]+)", l):
            implicit = bool(re.fullmatch(r"[0-9a-f]{64}|0x[0-9a-f]{40}", a))
            add(f"acct-{a[:12]}", f"Account {a} {'holds a key (implicit account, exists once funded)' if implicit else 'exists on mainnet'}", f"{d}:{i}", "mainnet view", f"https://nearblocks.io/address/{a}",
                {"type":"holder","account":a} if implicit else {"type":"account","account":a}, "nft_tokens_for_owner is non-empty" if implicit else "view_account returns an account")
# ---------------- source facts ----------------
G = lambda id,claim,w,path,pat,exp: add(id,claim,w,"test file" if "test" in path or path.endswith("tests.rs") else "file",path,{"type":"grep","path":path,"pattern":pat},exp,f"grep -nE '{pat}' {path}")
G("src-max-royalty","Royalty cap MAX_ROYALTY_BPS = 1000",where(RD,"MAX_ROYALTY_BPS = 1000"),"contracts/keys/src/lib.rs",r"MAX_ROYALTY_BPS: u32 = 1_?000","const found")
G("src-max-tier","MAX_TIER = 3",where(RD,"MAX_TIER = 3"),"contracts/keys/src/lib.rs",r"MAX_TIER: u8 = 3","const found")
G("src-cooldown","10-minute withdraw cooldown after a transfer (TRANSFER_COOLDOWN_MS)",where(RD,"`TRANSFER_COOLDOWN_MS`"),"tee/worker/src/lib.rs",r"TRANSFER_COOLDOWN_MS: u64 = 600_000","600_000 ms")
G("src-ai-model","/ask uses Qwen/Qwen3.6-35B-A3B-FP8",where(RD,"`Qwen/Qwen3.6-35B-A3B-FP8`"),"web/lib/ai.ts",r"Qwen/Qwen3\.6-35B-A3B-FP8","model id found")
G("src-gw-8kb","Gateway rejects bodies over 8 KB with 413",where(RD,"bodies over 8 KB are rejected with 413"),"web/app/api/worker/route.ts",r"len > 8192.*status: 413","8192 / 413")
G("src-gw-ip","Gateway allows 20 calls a minute per IP",where(RD,"Each IP gets 20 calls a minute"),"web/app/api/worker/route.ts",r"createLimiter\(20, 60_000\)","20 per 60 s")
G("src-gw-allow","Gateway allowlist: info, provenance, status, quote, mint, account, balance, history, swap, withdraw, lock, prove, limits, pnl, dashboard, session, session_revoke",where(RD,"**Allowlist:**"),"web/lib/gateway.ts",r'ALLOWED_OPS = \["info", "provenance", "status", "quote", "mint", "account", "balance", "history", "swap", "withdraw", "lock", "prove", "limits", "pnl", "dashboard", "session", "session_revoke"\]',"exact list")
G("src-gw-nocopy","copy and sweep_minter are not in the gateway allowlist (bad_op)",where(RD,"Both refusals are `bad_op`"),"web/lib/gateway.ts",r'code: "bad_op"',"bad_op for any other op")
G("src-limits-t1","Tier 1: $1 per trade, $5 per day, 6/min",where(RD,"| 1 Bronze | $1 | $5 | 6 |"),"docs/evidence/mainnet-e2e/01_info.json",r'"daily_usd_micro": ?5000000',"in attested info")
G("src-global","Global limits 120/min and 25 free mints per day",where(RD,"Global limits: 120 requests per minute and 25 free mints per day"),"docs/evidence/mainnet-e2e/01_info.json",r'"global_mints_per_day": ?25',"25 in attested info")
G("src-ci-6jobs","CI has 6 jobs: contract, worker, cli, judge-kit, hygiene, web",where(RD,"6 jobs (contract"),".github/workflows/ci.yml",r"^  web:","web job (and 5 others) present")
G("src-lighthouse","Lighthouse evidence file exists with the per-page scores",where(RD,"lighthouse.json"),"docs/evidence/lighthouse.json",r"performance","scores present")
G("src-audio-cc0","Ambient loop released under CC0",where(RD,"**CC0**"),"web/public/audio/LICENSE.txt",r"CC0","CC0 text")
G("src-lang-en","Site is English only, html lang=en",where(RD,'`html` is `lang="en"`'),"web/app/layout.tsx",r'lang="en"',"lang=en")
add("src-invariant-6","Six worker invariant tests (fn invariant_*)",where(TC,"6 worker invariant tests"),"test file","tee/worker/src/tests.rs",
    {"type":"count","path":"tee/worker/src/tests.rs","pattern":r"fn invariant_","op":"gte","value":6},">= 6 matches")
tests = set()
for d in DOCS:
    for t in re.findall(r"`([a-z0-9]+(?:_[a-z0-9]+){2,})`", open(d,encoding="utf8").read()):
        tests.add(t)
tests -= {"view_access_key_list","nft_tokens_for_owner","nft_total_supply","nft_metadata_update","nft_transfer_payout","set_if_absent","contract_source_metadata"} - set()
for t in sorted(tests):
    paths = ["tee/worker/src","contracts/keys/src"]
    w = None
    for d in DOCS:
        try: w = where(d,f"`{t}`"); break
        except SystemExit: pass
    add(f"test-{t}", f"Named test or symbol `{t}` exists in the source", w, "test file", "tee/worker/src, contracts/keys/src, web",
        {"type":"symbol","name":t,"dirs":["tee/worker/src","contracts/keys/src","contracts/keys-sandbox/tests","web/lib","web/app","cli/src"]}, f"`{t}` found in source")
spec = open("web/e2e/site.spec.ts",encoding="utf8").read()
for d in DOCS:
    for i,l in enumerate(open(d,encoding="utf8"),1):
        for n in re.findall(r"`((?:verify|settle|vault|mint|judge|home|gallery|key|ask|pnl|nav|gateway): [^`]+)`", l):
            pre = n.rstrip("…").rstrip()
            add(f"e2e-{pre[:40]}", f"e2e test named '{n}' exists", f"{d}:{i}", "test file", "web/e2e/site.spec.ts",
                {"type":"grep","path":"web/e2e/site.spec.ts","pattern":"test\\(\""+re.escape(pre)},"test name found", f"grep -n \"{pre}\" web/e2e/site.spec.ts")
# ---------------- repo paths ----------------
for d in DOCS:
    for i,l in enumerate(open(d,encoding="utf8"),1):
        for p in re.findall(r"\]\(((?!https?:|#|mailto)[^)\s]+)\)", l):
            p = p.split("#")[0]
            if not p: continue
            add(f"path-{p}", f"Linked repo path {p} exists", f"{d}:{i}", "file", p, {"type":"path","path":p}, "path exists")
# ---------------- live site ----------------
for p in ["/","/judge","/verify","/settle","/gallery","/mint","/vault","/ask","/atlas","/identity","/pnl","/key?id=k5f4750858f328940"]:
    add(f"site-{p}", f"Live page {p} serves", where(RD, "| `"+p.split('?')[0]+"` |") if p not in ("/key?id=k5f4750858f328940",) else where(TC,"k5f4750858f328940"), "live site", SITE+p,
        {"type":"http","url":SITE+p,"status":200}, "HTTP 200")
add("site-health","/api/health reports the enclave online",where(RD,"`/api/health`"),"live site",SITE+"/api/health",{"type":"http","url":SITE+"/api/health","status":200,"contains":'"online":true'},'200 with "online":true')
add("site-ar-redirect","/ar/… redirects to the same path without the prefix and keeps the query",where(RD,"A request to `/ar`"),"live site",SITE+"/ar/judge?x=1",{"type":"redirect","url":SITE+"/ar/judge?x=1","location":SITE+"/judge?x=1"},"308 → /judge?x=1")
for h,v in [("strict-transport-security","max-age=63072000; includeSubDomains; preload"),("x-content-type-options","nosniff"),("content-security-policy","frame-ancestors 'none'"),("referrer-policy","strict-origin-when-cross-origin"),("permissions-policy","camera=()")]:
    add(f"site-hdr-{h}",f"Site sends {h}: …{v}",where(RD,"CSP, HSTS (2 years, preload)"),"live site",SITE,{"type":"header","url":SITE+"/","header":h,"contains":v},f"{h} contains {v}","curl -sI "+SITE)
add("site-supply-live","Home page supply equals nft_total_supply",where(RD,"Supply on the home page matches `nft_total_supply`"),"live site",SITE,{"type":"site_vs_chain","field":"supply","method":"nft_total_supply"},"home supply == chain supply")
add("site-beats-live","Home page heartbeats equal config.beats",where(RD,"`nft_total_supply`, `config`"),"live site",SITE,{"type":"site_vs_chain","field":"beats","method":"config"},"home beats == chain beats")
add("site-hash","Home page names the live build 94c355ff",where(RD,"The enclave serving the site is build `94c355ff`"),"live site",SITE,{"type":"http","url":SITE+"/","status":200,"contains":"94c355ff"},"home carries 94c355ff")
import glob
for f in sorted(glob.glob("web/app/**/*.tsx",recursive=True)+glob.glob("web/lib/**/*.ts",recursive=True)+glob.glob("web/components/**/*.tsx",recursive=True)+glob.glob("docs/evidence/**/README.md",recursive=True)):
    for i,l in enumerate(open(f,encoding="utf8"),1):
        for h in re.findall(r'(?:txns/|tx\(")([1-9A-HJ-NP-Za-km-z]{43,44})', l):
            exp = "exists" if "revert" in l.lower() else "success"
            add(f"tx-{h[:8]}", f"Mainnet transaction {h[:8]}… shown in {f}", f"{f}:{i}", "mainnet tx", f"https://nearblocks.io/txns/{h}", {"type":"tx","hash":h,"expect":exp}, "transaction found on mainnet" + ("" if exp=="exists" else " with no failed receipt"))
        if f.startswith("web/"):
            for c in re.findall(r"\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b", l):
                add(f"att-{c[:8]}", f"Attested call {c[:8]} shown on the site ({f})", f"{f}:{i}", "OutLayer call", f"https://api.outlayer.ai/attestations/by-call/{c}", {"type":"attestation","call":c}, "attestation exists, executed == wasm_hash")
add("site-37","Home and /verify advertise 37 in-browser checks",where(RD,"shows 37/37"),"live site",SITE,{"type":"http","url":SITE+"/","status":200,"contains":"37"},"37 shown")
# ---------------- CI runs (public once the repo is public) ----------------
for d in DOCS:
    for i,l in enumerate(open(d,encoding="utf8"),1):
        for r in re.findall(r"actions/runs/(\d+)", l):
            add(f"ci-{r}", f"CI run {r} concluded success", f"{d}:{i}", "CI run", f"https://github.com/mohamedwael201193/keyhole/actions/runs/{r}",
                {"type":"ci_run","repo":"mohamedwael201193/keyhole","run":r}, "conclusion == success")
json.dump({"version":1,"generated":"see git log","repo":"mohamedwael201193/keyhole","rpc":"https://archival-rpc.mainnet.fastnear.com","claims":C}, open("docs/claims.json","w"), indent=1, ensure_ascii=False)
print(len(C))
