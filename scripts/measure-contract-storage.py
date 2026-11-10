#!/usr/bin/env python3
"""Offline captured-state estimate; NO RPC, funding or deployment."""
import hashlib,json
from pathlib import Path
r=Path(__file__).resolve().parents[1]
a=json.loads((r/"contracts/keys-sandbox/tests/fixtures/v24-public-account.json").read_text())
old=r/"contracts/keys/release/v2.4/keyhole_keys.wasm"
new=r/"contracts/keys/release/v2.5/keyhole_keys.wasm"
n=len(new.read_bytes());cost=10**19
usage=a["storage_usage"]+n-len(old.read_bytes())
print(json.dumps({"capture_block":a["block_height"],"candidate_bytes":n,"candidate_sha256":hashlib.sha256(new.read_bytes()).hexdigest(),"pre_optimization_candidate_bytes":458449,"saved_bytes":458449-n,"saved_code_storage_yocto":str((458449-n)*cost),"projected_post_deploy_storage_bytes":usage,"capture_balance_yocto":a["amount"],"code_storage_deficit_yocto_excluding_execution_and_migration":str(max(usage*cost-int(a["amount"]),0)),"qualification":"Captured state only; execution gas and migration state require additional balance. Not a mainnet quote or approval."},indent=2))
