#!/usr/bin/env python3
"""Path-only credential guard. No network, secrets, broad evidence or JSON exclusions.

The v2.7 exception pins the entire canonical public evidence snapshot (including
all keys/types/values), not merely a filename, tx label or ed25519 prefix. The
three pre-existing 1Click public-proof exceptions are narrowed from a directory
exclusion to their exact immutable snapshot + JSON signature pointer. Every other
byte/decoded JSON field in these files, and every other tracked file, is scanned.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

PATTERN = re.compile(r"wk_[0-9a-f]{16}|ed25519:[1-9A-HJ-NP-Za-km-z]{80,}|eyJhbGci[A-Za-z0-9_-]{20,}|BEGIN (RSA|OPENSSH|EC) PRIVATE")
PROMOTION = "docs/evidence/live-v2.7/promotion.public.json"
PUBLIC_TX = "6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h"
# Full canonical equality also closes unknown/moved fields and duplicate-key tricks.
PUBLIC = {
    PROMOTION: ("94ceb584b4ccd8ca5d077d4fa3a1c9a593f6506a6e9cc0b812cc9d4c4e5473bf", ("deployment", "transaction", "signature")),
    "docs/evidence/oneclick-sol/b7_real_sol_to_near_usdc_4000000.json": ("2afcc8918e857ba88d89d03491f9d4e78954520e3f9b33ba1765e6f9ae5146c5", ("signature",)),
    "docs/evidence/oneclick-sol/c6_status_success_4000000.json": ("233bd67db83daf9f82cc42e27470e18fe36bb4371521f2e42d1fbd8212443681", ("quoteResponse", "signature")),
    "docs/evidence/oneclick-sol/status_refunded_5sESFfrM.json": ("3d00f758cc5e5ff9c8ff883e7998400ab7e85438c42d6eae064b8aea649ce4f2", ("quoteResponse", "signature")),
}


def unique(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError("duplicate JSON key")
        obj[key] = value
    return obj


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def scan_file(path, raw):
    text = raw.decode("utf-8", errors="replace")
    try:
        value = json.loads(text, object_pairs_hook=unique)
    except (ValueError, TypeError):
        if path in PUBLIC:
            return False
        return not PATTERN.search(text)
    if path in PUBLIC:
        digest, pointer = PUBLIC[path]
        # Snapshot pin is an exact closed-schema/receipt equality check. Updating it
        # requires re-review of the original public proof, never just matching a TX.
        if hashlib.sha256(canonical(value).encode()).hexdigest() != digest:
            return False
        if path == PROMOTION:
            if (value.get("schema") != "KEYHOLE_V27_EVIDENCE_V1"
                    or set(value) != {"schema", "block", "account", "code", "metadata", "config", "pledge", "deployment"}
                    or value["deployment"]["final_execution_status"] != "FINAL"
                    or value["deployment"]["transaction"]["hash"] != PUBLIC_TX
                    or value["deployment"]["transaction_outcome"]["id"] != PUBLIC_TX):
                return False
        obj = value
        for key in pointer[:-1]:
            obj = obj[key]
        signature = obj[pointer[-1]]
        if not isinstance(signature, str) or not re.fullmatch(r"ed25519:[1-9A-HJ-NP-Za-km-z]{80,}", signature):
            return False
        # Raw and decoded scans: no escaped credential can hide in another field.
        text = text.replace(json.dumps(signature), '"PUBLIC_VERIFIED_SIGNATURE"', 1)
        obj[pointer[-1]] = "PUBLIC_VERIFIED_SIGNATURE"
    return not (PATTERN.search(text) or PATTERN.search(canonical(value)))


def scan_tree(root):
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
    failed = []
    for name in filter(None, names):
        path = root / name
        if path.is_symlink() or not path.is_file() or not scan_file(name, path.read_bytes()):
            failed.append(name)
        if name == "web/public/source/keyhole-src.tar.gz":
            try:
                with tarfile.open(path, "r:gz") as archive:
                    for member in archive:
                        if member.isdir():
                            continue
                        if not member.isfile() or not member.name.startswith("keyhole/"):
                            failed.append(name + " (invalid archive member)")
                            continue
                        inner = member.name.removeprefix("keyhole/")
                        if not scan_file(inner, archive.extractfile(member).read()):
                            failed.append(name + " -> " + inner)
            except (tarfile.TarError, OSError, ValueError):
                failed.append(name + " (invalid archive)")
    return failed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    bad = scan_tree(args.root)
    for name in bad:
        print("FAIL credential hygiene:", name)  # paths only; never echo a match
    if bad:
        raise SystemExit(1)
    print("PASS whole-tree credential hygiene; exact public-proof signature fields only")
