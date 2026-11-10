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
command -v "$PYTHONBIN" >/dev/null || { echo "FAIL missing python3 (stdlib only; no packages)"; exit 2; }

HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
ROOT="$(CDPATH= cd -- "$HERE/.." && pwd)"
DEFAULT_IDENTITY_URL="${IDENTITY_URL:-https://raw.githubusercontent.com/mohamedwael201193/keyhole/main/identity.json}"
OUTLAYER="${OUTLAYER_API:-https://api.outlayer.ai}"
# Known mainnet refusal: holder-to-holder transfer, "one key per account".
REFUSAL_TX="${REFUSAL_TX:-H8qJNgoxiizcJw63wKjtBZY4DQT8qbRx1XP9ejXSjkSV}"
REFUSAL_NEEDLE="${REFUSAL_NEEDLE:-one key per account}"

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
else
  if ! curl -fsSL --max-time 30 "$DEFAULT_IDENTITY_URL" -o "$IDENT"; then
    bad "could not fetch identity.json from $DEFAULT_IDENTITY_URL"
    say "----- $FAIL FAIL, $PASS PASS, $SKIP SKIP -----"
    exit 1
  fi
  say "identity  $DEFAULT_IDENTITY_URL"
fi

# All RPC + JSON work in one python process so we only need curl for OutLayer.
export IDENT OUTLAYER REFUSAL_TX REFUSAL_NEEDLE
export NEAR_RPC="${NEAR_RPC:-}"
"$PYTHONBIN" - <<'PY'
import json, os, sys, urllib.error, urllib.request

ident_path = os.environ["IDENT"]
outlayer = os.environ["OUTLAYER"].rstrip("/")
refusal_tx = os.environ["REFUSAL_TX"]
refusal_needle = os.environ["REFUSAL_NEEDLE"]
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
        want_owner = "keyhole-devmo.near"
        want_treasury = "keyhole-devmo.near"
        want_minter_len = 64
        problems = []
        if cfg.get("owner") != want_owner:
            problems.append("owner=%s" % cfg.get("owner"))
        if cfg.get("treasury") != want_treasury:
            problems.append("treasury=%s" % cfg.get("treasury"))
        minter = cfg.get("minter") or ""
        if len(minter) != want_minter_len:
            problems.append("minter is not a 64-char implicit account")
        # Live v2.4 royalty is 500 bps. Do not assert a candidate 0% rate.
        if cfg.get("royalty_bps") != 500:
            problems.append("royalty_bps=%s (live v2.4 is 500)" % cfg.get("royalty_bps"))
        if problems:
            bad("config() mismatch: %s" % "; ".join(problems))
        else:
            ok("config() owner=%s treasury=%s royalty_bps=500 minter is implicit" % (
                cfg["owner"], cfg["treasury"]))
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
    if ver == "2.4.0":
        ok("contract_source_metadata.version == 2.4.0 (live)")
    else:
        bad("contract_source_metadata.version == %r (expected live 2.4.0)" % ver)
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

# 4. Recorded mainnet refusal receipt
try:
    # Old receipts live on archival nodes. Final RPCs often hang or return UNKNOWN_TRANSACTION.
    archival = [u for u in rpcs if "archival" in u] + [u for u in rpcs if "archival" not in u]
    outcome = rpc(
        "tx",
        {"tx_hash": refusal_tx, "sender_account_id": account, "wait_until": "NONE"},
        urls=archival,
        timeout=10,
    )
    if not outcome:
        raise RuntimeError("empty tx status")
    text = json.dumps(outcome)
    # A failed receipt should carry the documented panic string.
    failed = (
        "Failure" in text
        or "failure" in text
        or '"status":{"Failure"' in text.replace(" ", "")
    )
    needle_ok = refusal_needle.lower() in text.lower()
    if failed and needle_ok:
        ok("tx %s… is a failed receipt containing %r" % (refusal_tx[:8], refusal_needle))
    else:
        bad("tx %s… did not show a failed receipt with %r (failed=%s needle=%s)" % (
            refusal_tx[:8], refusal_needle, failed, needle_ok))
except Exception as e:
    bad("tx status for %s failed: %s" % (refusal_tx, e))

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
