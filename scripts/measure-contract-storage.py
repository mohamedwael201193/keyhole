#!/usr/bin/env python3
"""Offline captured-state estimate; NO RPC, funding or deployment."""
import hashlib,json
from decimal import Decimal
from pathlib import Path
r=Path(__file__).resolve().parents[1]
a=json.loads((r/"contracts/keys-sandbox/tests/fixtures/v24-public-account.json").read_text())
old=r/"contracts/keys/release/v2.4/keyhole_keys.wasm"
new=r/"contracts/keys/release/v2.5/keyhole_keys.wasm"
n=len(new.read_bytes());cost=10**19;unit=10**24
usage=a["storage_usage"]+n-len(old.read_bytes())
near=lambda value: format(Decimal(value)/Decimal(unit),"f")
deficit=max(usage*cost-int(a["amount"]),0)
print(json.dumps({"capture_block":a["block_height"],"candidate_bytes":n,"candidate_sha256":hashlib.sha256(new.read_bytes()).hexdigest(),"storage_byte_cost_yocto":str(cost),"candidate_code_storage_near":near(n*cost),"additional_code_storage_near_vs_v24":near((n-len(old.read_bytes()))*cost),"projected_post_deploy_storage_bytes":usage,"projected_post_deploy_storage_near":near(usage*cost),"capture_balance_yocto":a["amount"],"code_storage_deficit_yocto_excluding_execution_and_migration":str(deficit),"code_storage_deficit_near_excluding_execution_and_migration":near(deficit),"qualification":"Captured public state only, not a current balance quote. Execution gas, migration state and operating capital are additional. No funding or deployment approval."},indent=2))