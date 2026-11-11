# LIVE LOANS V2 — operator execution only, not executed by this implementation

STOP until PR review/tests, exact built HNEW, singleton/drained workers, governance,
actual storage/gas/credit/funding gates pass. New code is not published. No command
here authorizes a bot to send. Credit: devmo. Team reviewer is NOT independent.
Security scope is reviewed worker + documented TEE/provider, not a global alias oracle.
Do not run the old runbook's pre-install AuthorityAuditV1 flow.

**BLOCKED: minimum-protected execution is unsupported by the documented provider API. Do not publish, pre-fund or enable lending using this runbook until the explicit execution gate in SECURITY.md is resolved.**

## 1. Session, fresh public state, unsigned evidence
```bash
set -euo pipefail; set +x; umask 077
export RPC=https://free.rpc.fastnear.com C=keyhole-devmo.near
export ASSET=nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1
export ASSET_CONTRACT=${ASSET#nep141:}
export L=0705fdc1581a35351453bd4625f22d0c41b2b9edc3e7bed860586623c6778228
export M=015a025906a59f9f40ca17daf2a3c61c5e63a37c081c75230870caa6a82ac443
NEAR=/home/box/.local/bin/near
OUT=/workspace/near_hackathon/upgrade/worker-loans-evidence/outlayer
export OUTLAYER_HOME=/workspace/near_hackathon/.secrets/olhome OUTLAYER_NETWORK=mainnet
KROOT=/workspace/near_hackathon/.secrets
OWNER_KEY="$KROOT/keyhole-devmo.json"
E=$(mktemp -d /workspace/handoff/live-loans-v2.XXXXXX); export E
AUTH=/workspace/handoff/worker-v2-auth.py
rpc() {
  python3 - "$1" "$2" <<'PYRPC'
import json,os,sys,urllib.request
b=json.dumps({'jsonrpc':'2.0','id':'keyhole-loans-read','method':sys.argv[1],'params':json.loads(sys.argv[2])}).encode()
r=json.load(urllib.request.urlopen(urllib.request.Request(os.environ['RPC'],data=b,headers={'Content-Type':'application/json'}),timeout=45))
if 'error' in r: raise SystemExit(json.dumps(r['error']))
print(json.dumps(r['result']))
PYRPC
}
refresh_block() {
  rpc block '{"finality":"final"}' > "$E/block.current.json"
  export BLOCK=$(jq -r '.header.hash' "$E/block.current.json")
}
q() {
  local encoded params
  encoded=$(printf '%s' "$3" | base64 -w0)
  params=$(jq -cn --arg b "$BLOCK" --arg c "$1" --arg m "$2" --arg a "$encoded" \
    '{request_type:"call_function",block_id:$b,account_id:$c,method_name:$m,args_base64:$a}')
  rpc query "$params" | python3 -c 'import json,sys;r=json.load(sys.stdin);assert "result" in r,r;print(bytes(r["result"]).decode())'
}

refresh_block
q "$C" governance_state '{}' > "$E/governance.before.json"
check_governance() { refresh_block; q "$C" governance_state '{}' > "$E/governance.current.json"; cmp <(jq -S . "$E/governance.before.json") <(jq -S . "$E/governance.current.json"); }
q "$C" config '{}' > "$E/config.before.json"
q "$C" get_pledge_config '{}' > "$E/pledge.before.json"
q outlayer.near get_project '{"project_id":"keyhole-devmo.near/keyhole"}' > "$E/project.before.json"
q outlayer.near list_versions '{"project_id":"keyhole-devmo.near/keyhole","from_index":0,"limit":100}' > "$E/versions.before.json"
q outlayer.near get_version_count '{"project_id":"keyhole-devmo.near/keyhole"}'
q "$C" nft_tokens_for_owner "{\"account_id\":\"$L\",\"from_index\":\"0\",\"limit\":100}" > "$E/L.tokens.before.json"
jq -e 'length==0' "$E/L.tokens.before.json"
rpc query "{\"request_type\":\"view_access_key_list\",\"account_id\":\"$L\",\"block_id\":\"$BLOCK\"}" > "$E/L.access-keys.before.json"
q "$C" collateral_registration_protocol '{}' 
q "$C" payout_storage_cost '{}'
rpc gas_price "[\"$BLOCK\"]"
# Canonical credential supplied securely; never echo it or rely on cwd .env.
export OUTLAYER_PAYMENT_KEY="$(< /workspace/near_hackathon/.secrets/outlayer_payment_key_2.txt)"
source scripts/worker/outlayer-grant.sh
grant_balance
call_json() {
  local signer="$1" key="$2" method="$3" args="$4" gas="$5" deposit="$6"
  "$NEAR" contract call-function as-transaction "$C" "$method" json-args "$args" \
    prepaid-gas "$gas" attached-deposit "$deposit" sign-as "$signer" \
    network-config mainnet sign-with-access-key-file "$key" send
}
call_file() {
  local signer="$1" key="$2" method="$3" argsfile="$4" gas="$5" deposit="$6"
  "$NEAR" contract call-function as-transaction "$C" "$method" file-args "$argsfile" \
    prepaid-gas "$gas" attached-deposit "$deposit" sign-as "$signer" \
    network-config mainnet sign-with-access-key-file "$key" send
}
```
Require code v2.7/hash26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c,
owner C, immutable M/attestor, lending OFF, protocol2, singleton expected H0,
UUID p000000000000004b and no unresolved native/provider jobs. Record all signer
balances/storage/access-key public identities. Pause UI/proxy AND direct submitters,
drain all old jobs. No contract/governance methods beyond the lending toggle.

After EVERY native/worker-native transaction: record original hash, query RPC FINAL,
check complete receipt lineage and intended transfer/callback/state, then
check_governance. UNKNOWN means original-only recovery, never a second send.
RPC: rpc tx '{"tx_hash":"ACTUAL_ORIGINAL_HASH","sender_account_id":"ACTUAL_SIGNER","wait_until":"FINAL"}'.
Those public hashes cannot be known before execution. Expected-failed FastFS gas1
uploads require exact indexed bytes, not a fictitious SuccessValue.

## 2. Build and publish worker (operator action, no contract deploy)
From reviewed feature checkout:
```bash
(cd tee/worker && ./build.sh) > "$E/HNEW.txt"
HNEW=$(tr -d '\n' < "$E/HNEW.txt"); export HNEW
node scripts/check-worker-candidate.mjs
WASM="$PWD/tee/worker/target/wasm32-wasip2/release/keyhole-worker.wasm"
node scripts/pledge/fastfs-payloads.mjs "$WASM" "$E/fastfs" auto 0 > "$E/fastfs-plan.json"
```
Inspect previous indexed FastFS nonce; substitute its actual value for0 if one exists.
For CHUNK=1, then each NEXT NEVER-SUBMITTED chunk only after FINAL/indexing check:
```bash
CHUNK=1
FILE=$(jq -er --argjson i "$CHUNK" '.chunks[$i-1].file' "$E/fastfs-plan.json")
test ! -e "$FILE.signed.json"
"$NEAR" contract call-function as-transaction outlayer.near __fastdata_fastfs file-args "$FILE" \
 prepaid-gas '0.000000000001 Tgas' attached-deposit '0 NEAR' sign-as "$C" \
 network-config mainnet sign-with-access-key-file "$OWNER_KEY" save-to-file "$FILE.signed.json"
node scripts/pledge/signed-hash.mjs "$FILE.signed.json" > "$FILE.signed-hash.json"
"$NEAR" transaction send-signed-transaction file-with-base64-signed-transaction "$FILE.signed.json" network-config mainnet send
# Resolve original, confirm chunk indexed; check_governance; only then next chunk.
```
Fetch assembled URL, require byte-for-byte artifact/hash equality:
```bash
curl -fS "https://main.fastfs.io/$C/outlayer.near/$HNEW.wasm" -o "$E/assembled.wasm"
cmp "$WASM" "$E/assembled.wasm"; sha256sum "$E/assembled.wasm"
```
Only if the two new local key files do not already exist, generate them using the
supplied helper (writes600 files, prints no secrets). Never overwrite existing keys:
```bash
python3 "$AUTH" keygen
BKEY="$KROOT/fresh_loan_borrower.json"; REVIEWER="$KROOT/collateral_auditor.json"
B=$(jq -er .account_id "$BKEY"); export B
TOKEN=$(python3 -c 'import hashlib,os;print("k"+hashlib.sha256(os.environ["B"].encode()).hexdigest()[:16])'); export TOKEN
REVIEW_PUB=$(jq -er .public_key_b64 "$REVIEWER")
jq -n --arg h "$HNEW" --arg p "$REVIEW_PUB" '{GUARDED_WORKER_HASH:$h,COLLATERAL_AUDITOR_PUBLIC_KEY:$p}' > "$E/secret-public-merge.json"
"$OUT" secrets update "$(jq -c . "$E/secret-public-merge.json")" --project keyhole-devmo.near/keyhole --profile default
```
This ONE approved exception attaches0.1NEAR+50T. MERGE preserves protected data/access;
never secrets set. Resolve original and actual refund/storage before next step.
Do not retry updater on UNKNOWN. Check governance unchanged.

Atomic add-active/remove sole old worker (actual snapshot, NOT old22-version planner):
```bash
HOLD=$(jq -er 'if length==1 and .[0].is_active==true then .[0].wasm_hash else error("not singleton") end' "$E/versions.before.json")
ADD=$(jq -cn --arg h "$HNEW" --arg u "https://main.fastfs.io/$C/outlayer.near/$HNEW.wasm" '{project_name:"keyhole",source:{WasmUrl:{url:$u,hash:$h,build_target:"wasm32-wasip2"}},set_active:true}')
REMOVE=$(jq -cn --arg h "$HOLD" '{project_name:"keyhole",version_key:$h}')
test ! -e "$E/registry.signed.json"
"$NEAR" transaction construct-transaction "$C" receiver-id outlayer.near \
 add-action function-call add_version json-args "$ADD" prepaid-gas '100 Tgas' attached-deposit '0.0044 NEAR' \
 add-action function-call remove_version json-args "$REMOVE" prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
 skip network-config mainnet sign-with-access-key-file "$OWNER_KEY" save-to-file "$E/registry.signed.json"
node scripts/pledge/signed-hash.mjs "$E/registry.signed.json" > "$E/registry.hash.json"
"$NEAR" transaction send-signed-transaction file-with-base64-signed-transaction "$E/registry.signed.json" network-config mainnet send
check_governance
q outlayer.near get_project '{"project_id":"keyhole-devmo.near/keyhole"}'
q outlayer.near get_version_count '{"project_id":"keyhole-devmo.near/keyhole"}'
q outlayer.near list_versions '{"project_id":"keyhole-devmo.near/keyhole","from_index":0,"limit":100}'
q "$C" config '{}'
```
Only HNEW registered/active; same UUID/M/attestor/sealed storage.0.0044 assumes same
URL encoding440bytes; reprice if shape differs. Verify old refund, never assume it.

## 3. Wallet setup / workers / mint
Prepare L's temporary credential copy locally as operator, never display its contents:
```bash
export KROOT
export TMPKEYS=$(mktemp -d /tmp/keyhole-loans-v2-keys.XXXXXX)
chmod 700 "$TMPKEYS"
export LKEY="$TMPKEYS/test_holder3.json"
trap 'rm -f -- "$LKEY"; rmdir -- "$TMPKEYS"' EXIT
python3 - <<'PYLKEY'
import os,json
from pathlib import Path
alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58(raw):
 n=int.from_bytes(raw,'big');s=''
 while n:n,r=divmod(n,58);s=alphabet[r]+s
 return '1'*(len(raw)-len(raw.lstrip(b'\0')))+s
account=os.environ['L'];raw=bytes.fromhex(account);assert len(raw)==32
record=json.loads(Path(os.environ['KROOT']+'/test_holder3.json').read_text())
assert record['account_id']==account and record.get('private_key',record.get('secret_key'))
public='ed25519:'+b58(raw)
assert not record.get('public_key') or record['public_key']==public
record['public_key']=public
fd=os.open(os.environ['LKEY'],os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:json.dump(record,f)
PYLKEY
```
BKEY is the new complete file from section2, not old test_holder2. No minter key export. No private values in argv/evidence; temp L file only is deleted on EXIT.

Native fund new B from approved team signer, and M to its checked mint/install/exit
reserve, one transfer<=.1 at a time. Source and amounts must fit actual spendable
balance/storage; working capital is not a fee. Exact installed near-cli transfer:
```bash
# Only if B is a never-funded implicit account and C retains storage + operating/upgrade reserve:
"$NEAR" tokens "$C" send-near "$B" '0.099 NEAR' network-config mainnet sign-with-access-key-file "$OWNER_KEY" send
# Verify original FINAL + exact Transfer/create-account + B public FullAccess; check_governance.
# M capital from L, only after reading its actual balance/storage and bounded reserve requirement:
"$NEAR" tokens "$L" send-near "$M" '0.06 NEAR' network-config mainnet sign-with-access-key-file "$LKEY" send
# Verify original FINAL + exact M Transfer; check_governance. Do not repeat on UNKNOWN.
```
Before each transfer record ledger and signer public nonce. Sponsor M payout slot
first; then missing B/L slots only (cost must still equal.0032):
```bash
call_json "$L" "$LKEY" register_payout_account "{\"account_id\":\"$M\"}" '20 Tgas' '0.0032 NEAR'
call_json "$B" "$BKEY" register_payout_account "{\"account_id\":\"$B\"}" '20 Tgas' '0.0032 NEAR'
call_json "$L" "$LKEY" register_payout_account "{\"account_id\":\"$L\"}" '20 Tgas' '0.0032 NEAR'
```
Skip already-paid slots; verify each native original+governance separately.
M needs>=.034 before mint; after mint recalculate storage+D+gas+reserve (worst
install balance~.09434). Do not assume a prior.06 top-up covers all new work.

```bash
# OUTLAYER_PAYMENT_KEY was securely supplied in section 1.
# Wrapper validates owner/nonce 2 before any submit or poll; CLI's PAYMENT_KEY
# alias is scoped per command, with version/async/compute/secrets pins retained.
source scripts/worker/outlayer-grant.sh
make_input() { python3 "$AUTH" auth "$1" "$2" "$3" "$4"; }
```
Every call: poll worker_status ORIGINAL_CALL_ID, verify actual OutLayer attestation
measured HNEW and exact bind.req_sha256/nonce, then save verified DECODED worker
output as the named .out.json. Do not mistake the transport wrapper for output or
resubmit a lost async job.3000 microUSD=$.003 per job, max33 reserved jobs=$.099; existing credit only, no top-up. Record actual compute_cost, and require no separate developer/operation charge. Failed or lost jobs consume their entire reserved allowance until proved otherwise.

Mint: fresh B signed mint params{}; worker attaches.012/20T from M. Verify token/B
owner/tier1; optional auto M refund is a SEPARATE70T native original, resolve it too.
```bash
printf '{}' > "$E/mint.params.json"
make_input "$BKEY" mint "$E/mint.params.json" "$E/mint.input.json"; worker_call "$E/mint.input.json"
# Resolve mint and auto refund originals. Then:
refresh_block
q "$C" nft_token "{\"token_id\":\"$TOKEN\"}"
q "$C" get_control_state "{\"token_id\":\"$TOKEN\"}" > "$E/control.json"
EPOCH=$(jq -er .owner_epoch "$E/control.json"); export EPOCH
q "$C" nft_tokens_for_owner "{\"account_id\":\"$L\",\"from_index\":\"0\",\"limit\":100}"
jq -n --arg t "$TOKEN" --arg e "$EPOCH" '{token_id:$t,owner_epoch:$e,fresh_only:true}' > "$E/create.params.json"
make_input "$BKEY" create_collateral_wallet "$E/create.params.json" "$E/create.input.json"; worker_call "$E/create.input.json"
```
Verify sanitized fresh manifest and actual source/namespace/registration/empty
inventory provenance. Do NOT call ordinary account before strict fresh creation.
Save verified create.out.json. No USDC until this genuine review passes.

## 4. Candidate, PRE-INSTALL Base funding, guardian and pre-review
```bash
jq -n --arg t "$TOKEN" --arg e "$EPOCH" --arg l "$L" '{token_id:$t,owner_epoch:$e,approvers:[{id:$l,role:"admin"}],threshold:1}' > "$E/candidate.params.json"
make_input "$BKEY" collateral_candidate "$E/candidate.params.json" "$E/candidate.input.json"; worker_call "$E/candidate.input.json"
# Resolve/verify/save candidate.out.json; review exact policy, not just a hash.
jq -n --arg t "$TOKEN" --arg e "$EPOCH" '{token_id:$t,owner_epoch:$e,chain:"base",token:"USDC",amount:"900000",min_credit_raw:"800000"}' > "$E/funding.params.json"
make_input "$BKEY" collateral_funding_quote "$E/funding.params.json" "$E/funding.input.json"; worker_call "$E/funding.input.json"
```
Quote creates a private incoming-deposit request, not an outgoing loan. MUST be
before locked policy because documented deposit-family gates as call; never add
arbitrary call capability. Require actual output amount900000/min>=800000,
unexpired deadline with signing margin, native Base USDC and canonical destination.
Only then operator MetaMask sends EXACT900000 raw USDC from
0xf76e6B0920e9332fF4410f6dD53F01722AbC71a3 to actual quote.deposit_address on Base8453,
contract0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913. No unlimited approval/ETH-as-USDC.
Observed2.747904USDC/.000100372662692192ETH; re-read and eth_estimateGas + Base L1 fee
with actual recipient. Proposed ETH fee ceiling.00005; separate asset, not zero.
Verify FINAL Base status1 + exact Transfer log, original OutLayer status and actual
canonical confidential NEAR-USDC credit. No public fallback if503/unknown route.

```bash
jq -n --arg t "$TOKEN" --arg e "$EPOCH" '{token_id:$t,owner_epoch:$e}' > "$E/funding-status.params.json"
make_input "$BKEY" collateral_funding_status "$E/funding-status.params.json" "$E/funding-status.input.json"; worker_call "$E/funding-status.input.json"
# Poll original, require credit_verified=true, >=800000 and complete terminal inventory.
python3 "$AUTH" guardian "$LKEY" "$E/candidate.out.json" "$E/guardian-pre.json"
jq --slurpfile g "$E/guardian-pre.json" '. + {guardian_proof:$g[0]}' "$E/candidate.params.json" > "$E/prepare.params.json"
make_input "$BKEY" prepare_collateral "$E/prepare.params.json" "$E/prepare.input.json"; worker_call "$E/prepare.input.json"
```
Resolve/verify prepare.out.json; preserve provision_id P and original epoch. Genuine
team reviewer writes private pre-review.md after inspecting manifest, complete known
authority inventory, candidate plaintext and actual guardian proof. No invented
independent audit or pre-install effective-policy assertion. If guardian expires,
repeat prepare with NEW guardian signature (no second encrypt/sign POST), then
review/sign new preaudit binding that observed guardian hash.

```bash
P=$(jq -er .provision_id "$E/prepare.out.json"); export P
REVIEW_HASH=$(sha256sum "$E/pre-review.md" | cut -d' ' -f1)
NOW=$(rpc block '{"finality":"final"}' | jq -er '((.header.timestamp_nanosec//.header.timestamp)|tonumber/1000000000|floor)')
jq -n --arg c "$C" --arg p "$P" --arg r "$REVIEW_HASH" --slurpfile x "$E/prepare.out.json" --argjson n "$NOW" \
 '{domain:"KEYHOLE_COLLATERAL_PRE_AUDIT_V2",project_uuid:"p000000000000004b",contract:$c,provision_id:$p,manifest_sha256:$x[0].manifest_sha256,candidate_policy_sha256:$x[0].candidate_policy_sha256,guardian_sha256:$x[0].guardian_sha256,authority_scope:"reviewed-worker-and-documented-tee-provider-v2",report_sha256:$r,candidate_policy_reviewed:true,fresh_creation_reviewed:true,known_authorities_reviewed:true,prior_jobs_drained:true,issued_at_sec:$n,expires_at_sec:($n+900)}' > "$E/pre.message.json"
python3 "$AUTH" review "$REVIEWER" KEYHOLE_COLLATERAL_PRE_AUDIT_V2 "$E/pre.message.json" "$E/pre.signed.json"
jq -n --arg t "$TOKEN" --arg e "$EPOCH" --arg p "$P" '{token_id:$t,owner_epoch:$e,provision_id:$p}' > "$E/quote.params.json"
make_input "$BKEY" collateral_quote "$E/quote.params.json" "$E/quote.input.json"; worker_call "$E/quote.input.json"
```
Save verified quote.out.json, Q<=.04619, D=.02+Q<=.06619, actual ciphertext size.
Fund M to exact checked reserve if necessary; no oversized quote/historical shortcut.

## 5. Genuine install -> actual decrypted report -> separate post-review
```bash
D=$(jq -er .binding_deposit_yocto "$E/quote.out.json")
jq --slurpfile a "$E/pre.signed.json" --arg d "$D" '.+{pre_audit_message:$a[0].message,pre_audit_signature:$a[0].signature,max_deposit_yocto:$d}' "$E/quote.params.json" > "$E/provision.params.json"
make_input "$BKEY" provision_collateral "$E/provision.params.json" "$E/provision.input.json"; worker_call "$E/provision.input.json"
# M native register_collateral:200T+D. Resolve genuine FINAL original and callbacks.
check_governance
refresh_block
q "$C" get_collateral_binding "{\"token_id\":\"$TOKEN\"}"
q "$C" get_pending_registration "{\"token_id\":\"$TOKEN\"}"
q "$C" get_control_state "{\"token_id\":\"$TOKEN\"}"
```
Binding ready alone MUST return eligibility_sealed=false. Reconcile same original
if needed, never call register from a local M key. New guardian challenge:
```bash
python3 "$AUTH" guardian "$LKEY" "$E/candidate.out.json" "$E/guardian-post.json"
jq --slurpfile g "$E/guardian-post.json" --arg pe "$EPOCH" '.+{guardian_proof:$g[0],provision_owner_epoch:$pe}' "$E/quote.params.json" > "$E/report.params.json"
make_input "$BKEY" collateral_report "$E/report.params.json" "$E/report.input.json"; worker_call "$E/report.input.json"
```
Verify/save report.out.json. Team reviewer now reads actual report.message, exact
decrypted effective policy, public policy/binding/FINAL receipts, complete inventory,
current key/guardian and manifest. Privately write post-review.md. All six booleans
can only be true within explicit SECURITY scope. NEVER approve a policy-update probe.
If title changed: old-holder auth refused; rebuild current owner/epoch challenge and
report with original provision_owner_epoch, then fresh post review. No reinstallation.

```bash
NOW=$(rpc block '{"finality":"final"}' | jq -er '((.header.timestamp_nanosec//.header.timestamp)|tonumber/1000000000|floor)')
jq -n --arg c "$C" --arg p "$P" --slurpfile r "$E/report.out.json" --argjson n "$NOW" \
 '{domain:"KEYHOLE_COLLATERAL_POST_AUDIT_V2",project_uuid:"p000000000000004b",contract:$c,provision_id:$p,report_sha256:$r[0].report_sha256,authority_scope:"reviewed-worker-and-documented-tee-provider-v2",no_presigned_authorities:true,all_aliases_reviewed:true,old_jobs_drained:true,external_chain_authorities_reviewed:true,effective_policy_reviewed:true,reachable_quorum_verified:true,issued_at_sec:$n,expires_at_sec:($n+900)}' > "$E/post.message.json"
python3 "$AUTH" review "$REVIEWER" KEYHOLE_COLLATERAL_POST_AUDIT_V2 "$E/post.message.json" "$E/post.signed.json"
jq --slurpfile a "$E/post.signed.json" --slurpfile r "$E/report.out.json" --arg pe "$EPOCH" '.+{provision_owner_epoch:$pe,report_sha256:$r[0].report_sha256,post_audit_message:$a[0].message,post_audit_signature:$a[0].signature}' "$E/quote.params.json" > "$E/finalize.params.json"
make_input "$BKEY" finalize_collateral "$E/finalize.params.json" "$E/finalize.input.json"; worker_call "$E/finalize.input.json"
```
Require eligibility_sealed=true and immutable V2 companion; marker written last.
No contract tx in finalize. Recheck actual private floor>=.50, no pending jobs/value/
payout/registration, public matching locked/unfrozen policy, L still owns no NFT.
Only with finish+OFF budget reserved:
```bash
call_json "$C" "$OWNER_KEY" set_lending_enabled '{"enabled":true}' '20 Tgas' '1 yoctoNEAR'
check_governance
q "$C" get_pledge_config '{}'
```

## 6. Loan A — repaid, real principal and both return cashouts

Read a fresh same-block control/binding/config/empty L eligibility and private floor first. All calls below are future SEND commands and each must finish its full terminal checks before the next.

```bash
refresh_block
export DEADLINE=$(python3 -c 'import json,os;print(int(json.load(open(os.environ["E"]+"/block.current.json"))["header"]["timestamp_nanosec"])+600000000000)')
jq -n --arg t "$TOKEN" --arg l "$L" --arg d "$DEADLINE" \
 '{token_id:$t,terms:{lender:$l,principal:"10000000000000000000000",repayment:"10100000000000000000000",duration_sec:"600",grace_sec:"60",floor_raw:"500000",funding_deadline_ns:$d}}' > "$E/A.open.json"
call_file "$B" "$BKEY" open_loan "$E/A.open.json" '200 Tgas' '0.009 NEAR'
refresh_block
q "$C" get_loan "{\"token_id\":\"$TOKEN\"}" > "$E/A.loan.offered.json"
export NA=$(jq -er '.nonce' "$E/A.loan.offered.json")
```

Expected A nonce **1 only if no other opens happened**, but use actual NA, never guess. Opening emits `loan_open {token_id,nonce}`, enters Freezing, and calls `freeze_wallet` then policy read. Continue ONLY when `state:"Offered"`, `policy_busy:false`, no policy call pending, lower policy `frozen:true`, controller/locked/version/digest correct, control token pledged=true/pending_value_ops=0. There is **no separate “loan_offered” event**.

Read `get_lender_offer`: named L, `lender_has_no_key:true`, `lender_has_no_return_reservation:true`, owner_current=true, funding_open=true. Obtain a **fresh paid worker certificate**, input exactly:

```bash
jq -n --arg t "$TOKEN" --arg n "$NA" '{op:"loan_certificate",params:{token_id:$t,loan_nonce:$n}}' > "$E/A.certificate.input.json"
worker_call "$E/A.certificate.input.json"
# Poll the returned ORIGINAL ID, verify the actual attestation/request/output.
# Save its verified decoded worker output object (NOT the whole transport envelope) as:
# "$E/A.certificate.output.json"
```

Worker only accepts token_id/loan_nonce, derives floor from actual loan and signs canonical **Borsh** fields. Worker expiry normally **30 seconds**, contract allows at most 60 seconds. Verify runtime executed hash H independently, pinned Ed25519 attestor, network mainnet, C, token, NA, borrower/epoch, exact terms, fixed asset, wallet/policy/hash/version, floor_met=true, frozen=true, pending_value_ops="0", observed≤now<expiry. A registry string/signature alone is not runtime measurement. Never locally sign/edit/refresh a template. If stale before sending, stop and deliberately request another fresh same-loan certificate; do not retry a funding intent whose submission is unknown.

```bash
jq -e --arg t "$TOKEN" --arg n "$NA" \
 'if .ok==true and .certificate.token_id==$t and .certificate.loan_nonce==$n then {token_id:$t,nonce:$n,certificate:.certificate,signature:.signature} else error("wrong certificate") end' \
 "$E/A.certificate.output.json" > "$E/A.fund.json"
call_file "$L" "$LKEY" fund_loan "$E/A.fund.json" '200 Tgas' '0.01 NEAR'
# FINAL: loan_fund; DisbursementPending; due_ns=0; B credit includes exact principal.
# Check B available credit <=0.1 before claim: claim_payout drains ALL available credit.
call_json "$B" "$BKEY" claim_payout '{}' '50 Tgas' '1 yoctoNEAR'
# FINAL native Transfer to B AND exact success callback; loan_principal_delivered.
refresh_block
q "$C" get_loan "{\"token_id\":\"$TOKEN\"}" > "$E/A.loan.active.json"
# Require Active, due_ns>0, pending payout null, principal delivery null.
# Repay promptly within due+60 sec (revalidate chain time before signing).
call_json "$B" "$BKEY" repay_loan "{\"token_id\":\"$TOKEN\",\"nonce\":\"$NA\"}" '200 Tgas' '0.0101 NEAR'
# FINAL loan_repay: L's backed repayment credit is final immediately.
# Wait ordinary unfreeze+policy-read: loan_closed resolution=repaid, loan=null.
# Then cash out repayment to L and bond to B, each only if credit>0/pending=null.
call_json "$L" "$LKEY" claim_payout '{}' '50 Tgas' '1 yoctoNEAR'
call_json "$B" "$BKEY" claim_payout '{}' '50 Tgas' '1 yoctoNEAR'
check_governance
```

Check original receipts after EACH line; comments are gates, not permission to run uninterrupted. Confirm lender native transfer **0.0101**, borrower bond transfer **0.009**, zero remaining/pending credits, lower thaw, same B owner/wallet/epoch, no loan. If genuine settlement failure restores a credit, resolve the original and obtain a deliberate new cashout intent only after terminal failure; UNKNOWN is never a failed payout.

## 7. Loan B — quick genuine mainnet default -> default_claimed

Only after ALL A custody/native operations (and optional A ordinary exit if selected) are terminal. Recheck floor and complete authority/inventory, L still empty, fresh chain/config/offer deadline. Same token/wallet, fresh nonce/certificate, **1-second duration and zero grace**:

```bash
refresh_block
export DEADLINE=$(python3 -c 'import json,os;print(int(json.load(open(os.environ["E"]+"/block.current.json"))["header"]["timestamp_nanosec"])+600000000000)')
jq -n --arg t "$TOKEN" --arg l "$L" --arg d "$DEADLINE" \
 '{token_id:$t,terms:{lender:$l,principal:"10000000000000000000000",repayment:"10100000000000000000000",duration_sec:"1",grace_sec:"0",floor_raw:"500000",funding_deadline_ns:$d}}' > "$E/B.open.json"
call_file "$B" "$BKEY" open_loan "$E/B.open.json" '200 Tgas' '0.009 NEAR'
# Wait genuine terminal freeze/read, Offered/policy_busy=false.
refresh_block
q "$C" get_loan "{\"token_id\":\"$TOKEN\"}" > "$E/B.loan.offered.json"
export NB=$(jq -er '.nonce' "$E/B.loan.offered.json")
jq -n --arg t "$TOKEN" --arg n "$NB" '{op:"loan_certificate",params:{token_id:$t,loan_nonce:$n}}' > "$E/B.certificate.input.json"
worker_call "$E/B.certificate.input.json"
# Resolve original call, verify actual attestation/certificate as for A, then save decoded output.
jq -e --arg t "$TOKEN" --arg n "$NB" \
 'if .ok==true and .certificate.token_id==$t and .certificate.loan_nonce==$n then {token_id:$t,nonce:$n,certificate:.certificate,signature:.signature} else error("wrong certificate") end' \
 "$E/B.certificate.output.json" > "$E/B.fund.json"
call_file "$L" "$LKEY" fund_loan "$E/B.fund.json" '200 Tgas' '0.01 NEAR'
# Resolve exact FINAL fund; state DisbursementPending/due=0.
call_json "$B" "$BKEY" claim_payout '{}' '50 Tgas' '1 yoctoNEAR'
# Resolve exact successful principal native callback; state Active and due>0.
refresh_block
q "$C" get_loan "{\"token_id\":\"$TOKEN\"}" > "$E/B.loan.active.json"
# Re-run this read-only time check on a later FINAL block if it is still too early:
refresh_block
python3 - <<'PYDUE'
import json,os
p=os.environ['E'];l=json.load(open(p+'/B.loan.active.json'))
now=int(json.load(open(p+'/block.current.json'))['header']['timestamp_nanosec'])
assert l['state']=='Active' and int(l['due_ns'])>0
assert now>int(l['due_ns'])+int(l['terms']['grace_sec'])*1000000000,'STOP: default not due in FINAL chain time'
PYDUE
# Fresh owner=L receiver eligibility: no NFT / no return reservation; borrower still B.
call_json "$L" "$LKEY" claim_default "{\"token_id\":\"$TOKEN\",\"nonce\":\"$NB\",\"receiver_id\":\"$L\"}" '200 Tgas' '1 yoctoNEAR'
# FINAL title transfer + loan_default; UnlockPending/resolution=default_claimed.
# Wait genuine unfreeze/read: loan_closed resolution=default_claimed; loan=null.
# B gets its own bond, NOT lender. Claim only after B credit is present.
call_json "$B" "$BKEY" claim_payout '{}' '50 Tgas' '1 yoctoNEAR'
check_governance
```

Expected NB=2 only absent other opens. No `Default` enum or persistent `default_claimed` loan state exists: after claim it is **UnlockPending + resolution="default_claimed"**, then loan row is REMOVED and the final proof is `loan_closed` event with that resolution. Do not demand `get_loan.state=="default_claimed"`.

Result: NFT to L, same canonical wallet/binding, owner epoch **old+1**, approvals cleared, B no longer owns this token. Default takes **the entire confidential vault**, including unrelated assets and later deposits; there is no partial seizure/surplus refund. No new M/native repayment to L is invented. L keeps title in exchange for principal. A related-party intentional default is mechanism proof, NOT organic loan demand, independent-party safety or guaranteed lender profit.


## After A and B: actual confidential recovery and minter credits
Optional ordinary exit after A, before B (use actual current epoch, keep >=500000USDC units):
```bash
export HOLDER="$B" HOLDERKEY="$BKEY" EXIT_STEP=A.exit RAW=100000
```
After B instead set `HOLDER="$L" HOLDERKEY="$LKEY" EXIT_STEP=B.exit RAW=...` where RAW is the actual remaining private balance, <=900000 and within the $1 Bronze per-tx / $5 daily cap. L must first wait actual10min new-owner cooldown
then exit remaining quoted USDC. Execute this exact guarded block for each selected exit, changing only the public amount and evidence step:
```bash
refresh_block
q "$C" get_control_state "{\"token_id\":\"$TOKEN\"}" > "$E/$EXIT_STEP.control.json"
export EXIT_EPOCH=$(jq -er '.owner_epoch' "$E/$EXIT_STEP.control.json")
python3 - <<'PYEXIT'
import json,os
p={"token_id":os.environ['TOKEN'],"owner_epoch":os.environ['EXIT_EPOCH'],"chain":"near","token":os.environ['ASSET'],"amount":os.environ['RAW'],"to":os.environ['HOLDER']}
json.dump(p,open(os.environ['E']+'/'+os.environ['EXIT_STEP']+'.params.json','w'))
PYEXIT
make_input "$HOLDERKEY" withdraw_dry_run "$E/$EXIT_STEP.params.json" "$E/$EXIT_STEP.preview.input.json"
worker_call "$E/$EXIT_STEP.preview.input.json"
# Resolve original FINAL + genuine output; require .ok, positive minimum, quoted route to HOLDER.
# Abort on unknown schema, pending jobs, policy refusal, cooldown, or floor/cap violation.
# Hard STOP: no supported minimum-bound mechanism. No real withdrawal is authorized.
return 1 2>/dev/null || exit 1
# Resolve the original provider operation and its native admit/finish journal. Never POST again on UNKNOWN.
# If needed, take actual .value_op_id from the genuine output, then READ/RECONCILE only:
export VALUE_OP_ID=ACTUAL_VALUE_OP_ID_FROM_ORIGINAL_OUTPUT
jq -n --arg t "$TOKEN" --arg id "$VALUE_OP_ID" '{token_id:$t,value_op_id:$id}' > "$E/$EXIT_STEP.reconcile.params.json"
make_input "$HOLDERKEY" reconcile_value_op "$E/$EXIT_STEP.reconcile.params.json" "$E/$EXIT_STEP.reconcile.input.json"
worker_call "$E/$EXIT_STEP.reconcile.input.json"
# Require status=success, admission_finished=true, exact source-asset debit and destination FT receipt.
refresh_block
q "$ASSET_CONTRACT" ft_balance_of "{\"account_id\":\"$HOLDER\"}" > "$E/$EXIT_STEP.destination.balance.json"
q "$C" get_control_state "{\"token_id\":\"$TOKEN\"}" > "$E/$EXIT_STEP.control.after.json"
q "$C" pending_value_op_count "{\"token_id\":\"$TOKEN\"}" > "$E/$EXIT_STEP.active.after.json"
check_governance
```
Set `ASSET_CONTRACT=${ASSET#nep141:}` before this block. Query that account's FT storage registration and the exact dry quote first; don't add an unbudgeted storage payment. `ACTUAL_VALUE_OP_ID_FROM_ORIGINAL_OUTPUT` is a public runtime identifier, never a made-up retry id. No other receiver, no old-B signature after default.
No other receiver, no old-B signature after default. First withdraw_dry_run positive
amount_out/min_amount_out; preview is advisory, NOT a bound execution quote. STOP: provider WithdrawRequest has no documented minimum/quote lock. A separately approved slippage/fee policy and reviewed implementation are required before ANY real exit, funding or lending ON.
Actual provider status and destination tx are required, not just a dry quote.
Each real exit uses native begin35T+.01 deposit / finish35T+0. Resolve original
provider/native journals; use reconcile_value_op with actual value_op_id if unknown.
No retry or raw-signing workaround. A must leave floor>=.50 before B certificate.

M admission credits: current contract-owner NEP-413 claim_minter_credit params{};
```bash
printf '{}' > "$E/M.claim.params.json"
make_input "$OWNER_KEY" claim_minter_credit "$E/M.claim.params.json" "$E/M.claim.input.json"
worker_call "$E/M.claim.input.json"
# Require original native tx FINAL success, exact M→M transfer and payout callback;
# query get_payout_credit(M) / get_pending_payout(M), public view_account(M), and governance.
```
Fixed M→M claim70T+1yocto, no arbitrary receiver/amount. Resolve original FINAL and
transfer/callback. If UNKNOWN, the minter has a singleton WAL; inspect/reconcile only its ORIGINAL head, never a new claim:
```bash
printf '{}' > "$E/M.reconcile.params.json"
make_input "$OWNER_KEY" reconcile_minter_send "$E/M.reconcile.params.json" "$E/M.reconcile.input.json"
worker_call "$E/M.reconcile.input.json"
# Verify returned original hash matches the recorded M claim; no abort_unsent flag.
```
If a different unresolved minter head exists, stop for that original before doing anything else;
never repeated claim. This does not export M or sweep its working capital.

## Final OFF and receipt acceptance
```bash
call_json "$C" "$OWNER_KEY" set_lending_enabled '{"enabled":false}' '20 Tgas' '1 yoctoNEAR'
check_governance
q "$C" get_pledge_config '{}'
q "$C" get_loan "{\"token_id\":\"$TOKEN\"}"
q "$C" nft_token "{\"token_id\":\"$TOKEN\"}"
q "$C" get_control_state "{\"token_id\":\"$TOKEN\"}"
q "$C" get_collateral_binding "{\"token_id\":\"$TOKEN\"}"
q "$C" get_pending_registration "{\"token_id\":\"$TOKEN\"}"
# For each B/L/M: get_payout_credit {account_id}, get_pending_payout {account_id}.
```
Accept only real events loan_open, loan_fund, loan_principal_delivered, loan_repay,
loan_closed resolution=repaid; B loan_default and loan_closed default_claimed,
NEP171 nft_transfer B→L/memo loan default; actual native principal twice/L repayment/
B bond transfers. No persistent Default/default_claimed enum exists. No mark_default
method is needed: claim_default performs the due-time default claim. Record collateral_ready,
payout_claim and registration events too, plus full successful private recovery.
Final loan row null, policy thawed, owner L/epoch+1, no unexplained credits/pending/
liabilities, correct singleton/UUID/M/attestor and unchanged governance. Signed report
is worker evidence, not a fabricated NEP297 contract event. Intentional team default
is mechanism proof, not independent lending demand.

## Budget, abort, timing
Conditional expanded configured allocation approximately .343NEAR +.04 reserve=~.383; the new1248852-byte candidate increases upload cost relative to the old1085333-byte sample (roughly .0065 vs .005658NEAR for FastFS). Actual
Q/gas/secret retention may change it. Hard net expenditure<=.4NEAR with ledger and
completion/OFF reserve. Gross funding transfers/temporary deposits/peak liquidity are
separate columns: do not double-count internal transfers or assume refunds early.
If .4 means every gross debit before refunds, STOP for that explicit interpretation.
Source collateral0.90USDC (<=1); actual route fees fit that, Base ETH gas separate.
Compute comes from the $20 grant on owner keyhole-devmo.near nonce 2; key 1 retains the untouched separate $0.50 personal credit, but this plan caps max job reservations at33×.003=$.099. With .90 source collateral, total USDC debits <=.999 (collateral is mostly recoverable), excluding the separately bounded Base ETH gas. Never count existing compute credit as free. No topup. All other txs
<=.1 including gas; .1+gas secret update is the specifically approved exception.

Any failed gate before lending: stay OFF and stop. Unknown fresh/create/install stays
held, no marker deletion/rebind. After loan starts: OFF blocks new loans, not actual
repay/default/payout/reconcile. Principal UNKNOWN may require genuine24h reclaim,
so never promise same-day completion. Do not roll back by re-registering old unsafe code.
No publish/secret/policy change during live loans.
Separate governance apply eligible2026-11-12 14:34:17.027936 Africa/Cairo; accept
14:36:27.377191 Africa/Cairo. Apply precedes accept (accept clears staged upgrade).
This runbook executes neither. Finish all loans/jobs and OFF before that maintenance.

### Installed CLI verification notes
The installed `outlayer` has **no `verify` subcommand** (help checked read-only). Its `status CALL_ID` polls an original job. The HTTPS `--compute-limit 3000` maps to the documented `X-Compute-Limit` dollar budget ($0.003); on-chain the same flag means instructions, so **HTTPS + canonical OUTLAYER_PAYMENT_KEY with scoped CLI PAYMENT_KEY alias + --async are mandatory**, never fall back to an on-chain run. Official units: https://app.outlayer.ai/docs/https-api and https://raw.githubusercontent.com/out-layer/outlayer-cli/main/src/api.rs .

For each actual call, retain the original CLI transport log and use:
```bash
# CALL_ID is the actual UUID printed on the first submission, never a newly submitted job.
worker_status "$CALL_ID" > "$E/$CALL_ID.status.stdout" 2> "$E/$CALL_ID.status.stderr"
curl -fsS "https://api.outlayer.ai/attestations/by-call/$CALL_ID" -o "$E/$CALL_ID.attestation.json"
jq -e --arg h "$HNEW" --arg id "$CALL_ID" '.call_id==$id and .project_id=="keyhole-devmo.near/keyhole" and .executed_wasm_sha256==$h and .wasm_hash==$h and .build_target=="wasm32-wasip2"' "$E/$CALL_ID.attestation.json"
```
Decode the actual CLI status output (stdout is not promised to be the API wrapper). Save the verified worker JSON to each named `.out.json` above. The existing website `/verify?call=CALL_ID` runs `web/lib/dcap.ts` plus `web/lib/pcs.ts` cryptographic Intel-chain, report-data and current collateral/TCB checks. Download and inspect its full findings. Merely `tdx_quote.length>100`, the CLI `keyhole verify`, or the older shell `verify.sh` is **not** full quote verification. A source candidate is not yet the historical live identity: compare measured hash to HNEW explicitly, do not change old proof history or treat a stale current-build badge as new evidence. Bindings must match exact requested `auth.message` SHA256 and nonce; output hash must match key-sorted canonical output. Stop on failed/unknown DCAP/collateral/TCB or measurement/source mismatch. No credential or private inventory may be pasted into a public verifier. The TEE/provider/future-publisher assumptions in SECURITY.md still apply even when every check passes.

### Final local candidate identity
Source candidate only: SHA256 `d0849f3e61d27aeb6e7a18a89b8909e1b2f03d0cfbeffd97937a664f2d4dfe60`, 1248852 bytes, generated candidate status `source-candidate-not-published`. Live worker identity remains `62398a8a…307f`; contract v2.7 bytes/ABI unchanged. Rebuild/check before operator publication; do not substitute a later artifact silently. The budget is a conditional conservative allocation, not a real provider quote or receipt. If the .003-per-job cap cannot execute a phase, STOP before signing a replacement, reassess the <=1USDC overall target and preserve UNKNOWN recovery.

Public working-capital read during preparation (FINAL block224095396): C amount6.872881570179187962621659NEAR/storage525930B, L amount.178925427887895399999996NEAR/storage182B, M amount.040829047361825799999999NEAR/storage315B. At1e19yocto/B the approximate storage-adjusted amounts are1.61358157/.17710543/.03767905NEAR respectively; refresh before every send. C sponsoring B avoids draining L below lender/slot/gas capital. The .099 and .06 transfers are internal liquidity, not additional net fees. M's actual post-mint/install quote and reserve still gate any action; no second top-up is automatic.

## Budget bound and existing identity drift — do not overlook
The ~.383NEAR figure is a **conditional planning target**, not a proved all-prepaid upper bound. Combining the older .26579 core storage+gas envelope with the new secret/update, mint, upload/registry and private-exit/credit-cleanup envelopes can reach roughly **.43NEAR** at the maximum policy quote if every prepaid gas reserve is burned. Before funding or lending, calculate from actual Q, gas price, already FINAL burned/refunded amounts and the remaining worst completion/OFF reserve; require total <=.4 or STOP for a budget decision. Do not disguise a .43 worst-case envelope as .383 guaranteed cost. Typical actual burn can be lower, but has not been measured for these new live calls.

The live identity has been evidence-promoted to v2.7 from the genuine FINAL deployment `6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h`, current pinned-block code/version/config and exact local release bytes. Public evidence is docs/evidence/live-v2.7/promotion.public.json. No deploy/governance transaction is needed or permitted to repair metadata. All contracts/ files remain unchanged; strict verifiers select existing release/v2.7 bytes while historical deployed/v2.6 evidence is retained. Worker remains unpublished.

## PR208 corrected candidate gate
All withdrawal execution is fail-closed before custody/spend/POST. A holder-signed
minimum and deadline alone cannot make the provider enforce them. No invented API
parameter is sent. Preview output explicitly reports advisory_only=true and
minimum_bound_to_execution=false. Do not start live loans or pre-funding while
terminal minimum-protected recovery cannot be completed. No slippage exception
is approved by this runbook. See SECURITY.md and withdrawal_protection.rs.
