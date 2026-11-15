#!/usr/bin/env python3
"""Strip expect and note from the ACP conformance case file, so the reader sees inputs only.

python3 make_inputs.py <conformance_cases.json>   writes inputs.json beside this file
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
src = json.load(open(sys.argv[1]))
cases = [{"id": c["id"], "input": c["input"]} for c in src["cases"]]
with open(os.path.join(HERE, "inputs.json"), "w") as f:
    json.dump(cases, f, indent=2)
    f.write("\n")
print(len(cases), "cases, expect and note removed")
