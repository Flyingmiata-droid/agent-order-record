"""Run this repo's Stripe-built receipts through the UCP conformance verifier.

The verifier is not ours: it is common/payments/ap2_receipt_verifier.py from
Universal-Commerce-Protocol/conformance PR 136 (ynachiket). Point this script
at a checkout of that branch.

  node scripts/ucp-export.ts /tmp/ucp-out
  python3 conformance/ucp-order-receipts/run_verifier.py <conformance checkout> /tmp/ucp-out

Exit code 0 only if the verifier accepts every receipt in every file with no
outcome, warning, reconciliation finding or malformed entry.
"""
import json
import pathlib
import sys

conf, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
sys.path.insert(0, str(conf))
from common.payments import ap2_receipt_verifier as v  # noqa: E402

bad = 0
files = sorted(out.glob("*.json"))
for path in files:
  doc = json.loads(path.read_text(encoding="utf-8"))
  i = doc["inputs"]
  r = v.verify_order_receipts(
    i["order"],
    {iss: issuer["keys"] for iss, issuer in i["issuers"].items()},
    [v.Mandate(m["credential_token"], m["business"], m["payment_amount"]) for m in i["mandates"]],
  )
  findings = (
    [f"outcome {f.receipt_index}:{f.code}" for f in r.outcomes]
    + [f"warning {f.receipt_index}:{f.code}" for f in r.warnings]
    + [f"reconciliation {f.receipt_index}:{f.code}" for f in r.reconciliation]
    + [f"malformed {m[0]}:{m[1]}" for m in r.malformed]
  )
  n = len(i["order"]["ap2"]["receipts"])
  ok = not findings and len(r.verified) == n
  bad += 0 if ok else 1
  print(("PASS " if ok else "FAIL ") + f"{doc['id']}: {n} receipts, {len(r.verified)} verified"
        + (", halted" if doc.get("halted") else "") + ("" if ok else " | " + "; ".join(findings)))
print(f"{len(files) - bad} of {len(files)} files clean")
sys.exit(1 if bad or not files else 0)
