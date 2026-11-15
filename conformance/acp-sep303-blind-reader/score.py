#!/usr/bin/env python3
"""Score results.json against the expect blocks in the case file.

python3 score.py <conformance_cases.json>
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
exp = {c["id"]: c["expect"] for c in json.load(open(sys.argv[1]))["cases"]}
res = json.load(open(os.path.join(HERE, "results.json")))
KEYS = ["eligible", "not_eligible", "approval_bound", "det_ok"]
ok = 0
for cid, e in exp.items():
    r = res.get(cid, {})
    diffs = [f"{k}: want {e.get(k)} got {r.get(k)}" for k in KEYS if k in e and e.get(k) != r.get(k)]
    if "per_line" in e:
        rl = {p.get("line_id"): p for p in r.get("per_line", [])}
        for p in e["per_line"]:
            q = rl.get(p["line_id"], {})
            diffs += [f"{p['line_id']}.{f}: want {p.get(f)} got {q.get(f)}"
                      for f in ["outcome", "amount", "rule", "finding"] if p.get(f) != q.get(f)]
    if "det_problems" in e and sorted(e["det_problems"]) != sorted(r.get("det_problems", [])):
        diffs.append(f"det_problems: want {sorted(e['det_problems'])} got {sorted(r.get('det_problems', []))}")
    ok += not diffs
    print(cid, "PASS" if not diffs else "FAIL", "; ".join(diffs))
print(f"\nSCORE {ok}/{len(exp)}")
