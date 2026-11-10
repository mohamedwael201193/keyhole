#!/usr/bin/env python3
"""Negatives for the recorded refusal predicate. No network."""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import receipt_proof as rp


def good():
    proof = rp.RECORDED_REFUSAL
    failure = {"Failure": {"ActionError": {"index": 0, "kind": {"FunctionCallError": {"ExecutionError": proof["execution_error"]}}}}}
    return {
        "final_execution_status": "FINAL",
        "status": copy.deepcopy(failure),
        "transaction": {
            "hash": proof["hash"],
            "signer_id": proof["signer_id"],
            "receiver_id": proof["receiver_id"],
            "actions": [{
                "FunctionCall": {
                    "method_name": proof["method_name"],
                    "deposit": proof["deposit"],
                    "args": "eyJyZWNlaXZlcl9pZCI6ImtleWhvbGUtZGV2bW8ubmVhciIsInRva2VuX2lkIjoiazVmNDc1MDg1OGYzMjg5NDAifQ==",
                }
            }],
        },
        "receipts_outcome": [
            {"outcome": {"executor_id": proof["receiver_id"], "status": copy.deepcopy(failure), "logs": []}},
            {"outcome": {"executor_id": proof["signer_id"], "status": {"SuccessValue": ""}, "logs": []}},
        ],
    }


class RefusalProof(unittest.TestCase):
    def test_exact_recorded_shape_passes(self):
        ok, _ = rp.matches_recorded_refusal(good())
        self.assertTrue(ok)

    def test_wrong_hash_fails(self):
        doc = good()
        doc["transaction"]["hash"] = "A" * 44
        self.assertFalse(rp.matches_recorded_refusal(doc)[0])

    def test_wrong_receiver_fails(self):
        doc = good()
        doc["transaction"]["receiver_id"] = "other.near"
        self.assertFalse(rp.matches_recorded_refusal(doc)[0])

    def test_wrong_signer_fails(self):
        doc = good()
        doc["transaction"]["signer_id"] = "keyhole-devmo.near"
        self.assertFalse(rp.matches_recorded_refusal(doc)[0])

    def test_non_final_fails(self):
        for status in ("NONE", "EXECUTED", "EXECUTED_OPTIMISTIC", None):
            doc = good()
            doc["final_execution_status"] = status
            self.assertFalse(rp.matches_recorded_refusal(doc)[0], status)

    def test_success_with_panic_only_in_a_log_fails(self):
        doc = good()
        success = {"SuccessValue": ""}
        doc["status"] = success
        doc["receipts_outcome"][0]["outcome"]["status"] = success
        doc["receipts_outcome"][0]["outcome"]["logs"] = [rp.RECORDED_REFUSAL["execution_error"]]
        self.assertFalse(rp.matches_recorded_refusal(doc)[0])

    def test_wrong_panic_fails(self):
        doc = good()
        wrong = "Smart contract panicked: already migrated"
        doc["status"]["Failure"]["ActionError"]["kind"]["FunctionCallError"]["ExecutionError"] = wrong
        doc["receipts_outcome"][0]["outcome"]["status"]["Failure"]["ActionError"]["kind"]["FunctionCallError"]["ExecutionError"] = wrong
        self.assertFalse(rp.matches_recorded_refusal(doc)[0])

    def test_wrong_method_and_args_fail(self):
        doc = good()
        doc["transaction"]["actions"][0]["FunctionCall"]["method_name"] = "nft_mint"
        self.assertFalse(rp.matches_recorded_refusal(doc)[0])
        doc = good()
        doc["transaction"]["actions"][0]["FunctionCall"]["args"] = {"receiver_id": "bob.near", "token_id": "k1"}
        self.assertFalse(rp.matches_recorded_refusal(doc)[0])

    def test_phrase_is_not_accepted_from_serialized_logs_alone(self):
        text = json.dumps(good())
        self.assertIn("one key per account", text)
        stripped = good()
        stripped["status"] = {"SuccessValue": ""}
        stripped["receipts_outcome"][0]["outcome"]["status"] = {"SuccessValue": ""}
        stripped["receipts_outcome"][0]["outcome"]["logs"] = ["Failure: one key per account"]
        self.assertFalse(rp.matches_recorded_refusal(stripped)[0])


if __name__ == "__main__":
    unittest.main()
