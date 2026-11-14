#!/usr/bin/env python3
# Thin alias for judge/gen-claims.py (regenerates docs/claims.json the same way).
# Usage (from a checkout): python3 verify/gen-claims.py .
import os
import runpy
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "..", "judge", "gen-claims.py")
sys.argv[0] = TARGET
sys.path.insert(0, os.path.dirname(TARGET))
runpy.run_path(TARGET, run_name="__main__")
