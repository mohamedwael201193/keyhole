#!/usr/bin/env bash
# KEYHOLE zero-install live check.
# Needs: curl, python3 (stdlib only). No wallet, no Rust, no npm, no jq.
# Proves, against NEAR mainnet and the public attestation API:
#   1. on-chain contract code_hash equals identity.json
#   2. live view methods (config, source metadata, supply)
#   3. one recorded TEE attestation (the live worker info call)
#   4. one recorded mainnet refusal receipt
# Usage (from a checkout):  bash judge/0-live.sh
# Usage (no checkout):      curl -fsSL <raw-url-of-this-file> -o /tmp/keyhole-live.sh && bash /tmp/keyhole-live.sh
# Optional env: NEAR_RPC, IDENTITY_URL, IDENTITY_JSON, OUTLAYER_API
set -eu
# Some public RPCs close the connection without HTTP; do not `set -o pipefail`
# until after the python helper, so a single RPC miss can fall through.

PYTHONBIN="${PYTHONBIN:-python3}"
command -v curl >/dev/null || { echo "FAIL missing curl"; exit 2; }
if ! command -v "$PYTHONBIN" >/dev/null; then
  if command -v python >/dev/null && python -c 'import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)'; then
    PYTHONBIN=python
  else
    echo "FAIL missing python3 (stdlib only; no packages)"
    exit 2
  fi
fi

HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$HERE/.." && pwd)"
OUTLAYER="${OUTLAYER_API:-https://api.outlayer.ai}"
# Recorded refusal predicate lives next to this script (stdlib Python, no packages).
RECEIPT_PY="$HERE/receipt_proof.py"
if [ ! -f "$RECEIPT_PY" ]; then
  echo "FAIL missing $RECEIPT_PY. Download judge/0-live.sh, judge/receipt_proof.py and identity.json from the same commit, and set IDENTITY_JSON."
  exit 2
fi

# Resolve identity.json: local checkout, IDENTITY_JSON, or the published raw file.
IDENT_SRC=""
if [ -n "${IDENTITY_JSON:-}" ] && [ -f "$IDENTITY_JSON" ]; then
  IDENT_SRC="$IDENTITY_JSON"
elif [ -f "$ROOT/identity.json" ]; then
  IDENT_SRC="$ROOT/identity.json"
fi

PASS=0; FAIL=0; SKIP=0
say() { printf '%s\n' "$*"; }
ok()  { say "PASS  $1"; PASS=$((PASS+1)); }
bad() { say "FAIL  $1"; FAIL=$((FAIL+1)); }
skip(){ say "SKIP  $1"; SKIP=$((SKIP+1)); }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
IDENT="$TMPDIR/identity.json"
if [ -n "$IDENT_SRC" ]; then
  cp "$IDENT_SRC" "$IDENT"
  say "identity  $IDENT_SRC"
elif [ -n "${IDENTITY_URL:-}" ]; then
  if ! curl -fsSL --max-time 30 "$IDENTITY_URL" -o "$IDENT"; then
    bad "could not fetch identity.json from $IDENTITY_URL"
    say "----- $FAIL FAIL, $PASS PASS, $SKIP SKIP -----"
    exit 1
  fi
  say "identity  $IDENTITY_URL"
else
  echo "FAIL set IDENTITY_JSON or IDENTITY_URL. This script does not guess a branch."
  exit 2
fi

# All RPC + JSON work in one python process so we only need curl for OutLayer.
export IDENT OUTLAYER RECEIPT_PY
export NEAR_RPC="${NEAR_RPC:-}"
"$PYTHONBIN" - <<'PY'
import json, os, sys, urllib.error, urllib.request

import importlib.util
ident_path = os.environ["IDENT"]
outlayer = os.environ["OUTLAYER"].rstrip("/")
receipt_py = os.environ["RECEIPT_PY"]
spec = importlib.util.spec_from_file_location("receipt_proof", receipt_py)
receipt_proof = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receipt_proof)
rpcs = []
if os.environ.get("NEAR_RPC"):
    rpcs.append(os.environ["NEAR_RPC"])
rpcs += [
    "https://rpc.mainnet.fastnear.com",
    "https://rpc.mainnet.near.org",
    "https://archival-rpc.mainnet.fastnear.com",
    "https://archival-rpc.mainnet.near.org",
]

def say(s):
    sys.stdout.write(s + "\n")
    sys.stdout.flush()

pass_n = fail_n = skip_n = 0

def ok(s):
    global pass_n
    say("PASS  " + s); pass_n += 1

def bad(s):
    global fail_n
    say("FAIL  " + s); fail_n += 1

def skip(s):
    global skip_n
    say("SKIP  " + s); skip_n += 1

def http_json(url, data=None, timeout=12):
    req = urllib.request.Request(
        url,
        data=None if data is None else json.dumps(data).encode(),
        headers={"content-type": "application/json", "accept": "application/json"},
        method="GET" if data is None else "POST",
    )
    last = None
    for _ in range(2):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
                return json.loads(body.decode())
        except Exception as e:
            last = e
    raise last

def rpc(method, params, urls=None, timeout=12):
    last = None
    payload = {"jsonrpc": "2.0", "id": "kh-live", "method": method, "params": params}
    for url in (urls or rpcs):
        try:
            doc = http_json(url, payload, timeout=timeout)
            if doc.get("error"):
                last = RuntimeError(str(doc["error"]))
                continue
            if "result" in doc:
                return doc["result"]
            last = RuntimeError("no result from %s" % url)
        except Exception as e:
            last = e
            continue
    raise last

try:
    ident = json.loads(open(ident_path, encoding="utf-8").read())
    contract = ident["contract"]
    worker = ident["worker"]
    account = contract["account"]
    expect_hash = contract["code_hash"]
    expect_wasm = worker["wasm_sha256"]
    info_call = worker["info_call"]
except Exception as e:
    bad("identity.json is unreadable: %s" % e)
    say("COUNTS %d %d %d" % (pass_n, fail_n, skip_n))
    sys.exit(1)

ok("identity.json names contract %s and worker %s…" % (account, expect_wasm[:8]))

# 1. On-chain code hash
try:
    acc = rpc("query", {"request_type": "view_account", "finality": "final", "account_id": account})
    got = acc.get("code_hash")
    if got == expect_hash:
        ok("on-chain code_hash %s == identity.json" % got)
    else:
        bad("on-chain code_hash %s != identity.json %s" % (got, expect_hash))
except Exception as e:
    bad("view_account failed: %s" % e)

def view(method, args=None):
    import base64
    raw = base64.b64encode(json.dumps(args or {}).encode()).decode()
    res = rpc("query", {
        "request_type": "call_function",
        "finality": "final",
        "account_id": account,
        "method_name": method,
        "args_base64": raw,
    })
    buf = bytes(res.get("result") or [])
    if not buf:
        return None
    try:
        return json.loads(buf.decode())
    except Exception:
        # some views return a raw JSON string (quoted)
        text = buf.decode()
        try:
            return json.loads(text)
        except Exception:
            return text

# 2. State views
try:
    cfg = view("config")
    if not isinstance(cfg, dict):
        bad("config() did not return a JSON object: %r" % (cfg,))
    else:
        # The expected owner is the pinned identity, not a hardcoded account:
        # accept_owner moved ownership to the guardian implicit account.
        want_owner = (ident.get("governance") or {}).get("owner") or "keyhole-devmo.near"
        want_treasury = "keyhole-devmo.near"
        pinned_minter = contract.get("minter") or ""
        problems = []
        if cfg.get("owner") != want_owner:
            problems.append("owner=%s" % cfg.get("owner"))
        if cfg.get("treasury") != want_treasury:
            problems.append("treasury=%s" % cfg.get("treasury"))
        minter = cfg.get("minter") or ""
        if not (isinstance(pinned_minter, str) and len(pinned_minter) == 64 and all(c in "0123456789abcdef" for c in pinned_minter)):
            problems.append("identity.json minter is not 64 lowercase hex")
        elif minter != pinned_minter:
            problems.append("minter %s != pinned identity %s" % (minter, pinned_minter))
        # Preserved live royalty is 500 bps. Do not assert a candidate 0% rate.
        if cfg.get("royalty_bps") != 500:
            problems.append("royalty_bps=%s (preserved live value is 500)" % cfg.get("royalty_bps"))
        if problems:
            bad("config() mismatch: %s" % "; ".join(problems))
        else:
            ok("config() owner=%s treasury=%s royalty_bps=500 minter=%s…" % (
                cfg["owner"], cfg["treasury"], minter[:8]))
        beats = cfg.get("beats")
        if beats is not None:
            say("      config.beats (grows) = %s" % beats)
except Exception as e:
    bad("config() failed: %s" % e)

try:
    meta = view("contract_source_metadata")
    ver = None
    if isinstance(meta, dict):
        ver = meta.get("version")
    if ver == contract.get("version", "2.4.0"):
        ok("contract_source_metadata.version == %s (live)" % ver)
    else:
        bad("contract_source_metadata.version == %r (expected %s)" % (ver, contract.get("version", "2.4.0")))
except Exception as e:
    bad("contract_source_metadata() failed: %s" % e)

try:
    supply = view("nft_total_supply")
    # view may return "6" or 6
    if isinstance(supply, str) and supply.isdigit():
        n = int(supply)
    elif isinstance(supply, int):
        n = supply
    else:
        n = None
    if n is not None and n >= 6:
        ok("nft_total_supply == %s (>= 6, captured 2026-11-09)" % n)
    else:
        bad("nft_total_supply == %r (expected >= 6)" % supply)
except Exception as e:
    bad("nft_total_supply() failed: %s" % e)

gov = ident.get("governance") or {}
gov_owner = gov.get("owner") or ""
owner_is_implicit = isinstance(gov_owner, str) and len(gov_owner) == 64 and all(c in "0123456789abcdef" for c in gov_owner)
# The pinned owner is cross-checked against live config() above; here the pin
# must be a 64-hex implicit account (the guardian since accept_owner).
if owner_is_implicit and gov.get("lending_enabled") is False and gov.get("access_key_total") == 3 and gov.get("full_access_keys") == 2 and gov.get("function_call_keys") == 1:
    ok("identity.governance owner=%s… lending_enabled=false access_key_total=3" % gov_owner[:8])
else:
    bad("identity.governance owner/lending/keys mismatch: %r" % {k: gov.get(k) for k in ("owner", "lending_enabled", "access_key_total", "full_access_keys", "function_call_keys")})

# 3. Recorded attestation: the live worker info call in identity.json
try:
    att = http_json("%s/attestations/by-call/%s" % (outlayer, info_call))
    executed = (att.get("executed_wasm_sha256") or "").strip()
    registered = (att.get("wasm_hash") or "").strip()
    quote = att.get("tdx_quote") or ""
    qlen = len(quote) if isinstance(quote, str) else 0
    if qlen > 100:
        ok("info call %s has a TDX quote (%d chars)" % (info_call, qlen))
    else:
        bad("info call %s has no TDX quote" % info_call)
    if executed == expect_wasm:
        ok("attested executed_wasm_sha256 == identity.json worker %s…" % expect_wasm[:8])
    else:
        bad("attested executed_wasm_sha256 %s != identity.json %s" % (executed, expect_wasm))
    if executed and executed == registered:
        ok("registered wasm_hash == executed_wasm_sha256")
    else:
        bad("registered wasm_hash %s != executed %s" % (registered, executed))
except Exception as e:
    bad("attestation fetch failed for %s: %s" % (info_call, e))

# 4. Recorded mainnet refusal receipt. FINAL, actual signer, typed contract failure.
try:
    proof = receipt_proof.RECORDED_REFUSAL
    # Old receipts live on archival nodes. Ask for FINAL and the recorded signer, not the contract account.
    archival = [u for u in rpcs if "archival" in u] + [u for u in rpcs if "archival" not in u]
    outcome = rpc(
        "tx",
        {"tx_hash": proof["hash"], "sender_account_id": proof["signer_id"], "wait_until": "FINAL"},
        urls=archival,
        timeout=20,
    )
    if not outcome:
        raise RuntimeError("empty tx status")
    matched, reason = receipt_proof.matches_recorded_refusal(outcome, proof)
    if matched:
        ok("tx %s… is FINAL with the typed one-key refusal (%s)" % (proof["hash"][:8], reason))
    else:
        bad("tx %s… is not the pinned FINAL refusal: %s" % (proof["hash"][:8], reason))
except Exception as e:
    bad("tx status for the recorded refusal failed: %s" % e)

say("COUNTS %d %d %d" % (pass_n, fail_n, skip_n))
sys.exit(1 if fail_n else 0)
PY
status=$?
# The python process printed PASS/FAIL and a COUNTS line. Re-print a summary
# from that line if present; otherwise use its exit status.
counts_line="$(grep '^COUNTS ' "$TMPDIR" 2>/dev/null || true)"
# Counts were printed to stdout, not a file. The script already printed each step.
if [ "$status" -eq 0 ]; then
  say "----- all steps PASS (live identities from identity.json; no wallet, no build) -----"
else
  say "----- one or more steps FAIL (exit $status). Live identities are in identity.json. -----"
fi
exit "$status"
