"""Strict FINAL receipt check for the recorded one-key refusal.

Stdlib only. A panic phrase in a log, a non-final status, or a different
hash, signer, receiver, method, or argument does not pass.
"""
import base64
import json

RECORDED_REFUSAL = {
    "hash": "H8qJNgoxiizcJw63wKjtBZY4DQT8qbRx1XP9ejXSjkSV",
    "signer_id": "3bde8ce5eb4e15403d49ba9512a98070db68958b39f378816f7862cee6168447",
    "receiver_id": "keyhole-devmo.near",
    "method_name": "nft_transfer",
    "deposit": "1",
    "args": {"receiver_id": "keyhole-devmo.near", "token_id": "k5f4750858f328940"},
    "execution_error": "Smart contract panicked: one key per account: receiver already holds a KEYHOLE key",
}


def execution_error(status):
    if not isinstance(status, dict):
        return None
    failure = status.get("Failure")
    if not isinstance(failure, dict):
        return None
    try:
        text = failure["ActionError"]["kind"]["FunctionCallError"]["ExecutionError"]
    except Exception:
        return None
    return text if isinstance(text, str) else None


def _decode_args(raw):
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        return None
    try:
        return json.loads(base64.b64decode(raw).decode())
    except Exception:
        return None


def matches_recorded_refusal(outcome, proof=None):
    """Return (ok, reason). Logs are ignored. The contract receipt and the root status must both carry the exact ExecutionError."""
    proof = proof or RECORDED_REFUSAL
    if not isinstance(outcome, dict):
        return False, "outcome is not an object"
    if outcome.get("final_execution_status") != "FINAL":
        return False, "status is not FINAL"
    tx = outcome.get("transaction")
    if not isinstance(tx, dict):
        return False, "missing transaction"
    if tx.get("hash") != proof["hash"]:
        return False, "hash mismatch"
    if tx.get("signer_id") != proof["signer_id"]:
        return False, "signer mismatch"
    if tx.get("receiver_id") != proof["receiver_id"]:
        return False, "receiver mismatch"
    actions = tx.get("actions")
    if not isinstance(actions, list) or len(actions) != 1 or not isinstance(actions[0], dict):
        return False, "expected one action"
    call = actions[0].get("FunctionCall")
    if not isinstance(call, dict):
        return False, "action is not a function call"
    if call.get("method_name") != proof["method_name"]:
        return False, "method mismatch"
    if call.get("deposit") != proof["deposit"]:
        return False, "deposit mismatch"
    if _decode_args(call.get("args")) != proof["args"]:
        return False, "args mismatch"
    expected = proof["execution_error"]
    if execution_error(outcome.get("status")) != expected:
        return False, "root status is not the typed contract failure"
    receipts = outcome.get("receipts_outcome")
    if not isinstance(receipts, list):
        return False, "missing receipts"
    contract = [
        row for row in receipts
        if isinstance(row, dict)
        and isinstance(row.get("outcome"), dict)
        and row["outcome"].get("executor_id") == proof["receiver_id"]
        and execution_error(row["outcome"].get("status")) == expected
    ]
    if len(contract) != 1:
        return False, "contract receipt does not carry the typed failure"
    return True, "FINAL typed refusal"
