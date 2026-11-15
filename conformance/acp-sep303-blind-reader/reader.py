#!/usr/bin/env python3
"""Blind independent reader for the ATDRP dispute_resolution RFC (rfc.md).

Reads inputs.json, writes results.json. Python 3 stdlib only.
Every rule carries a comment naming the RFC section it implements.
Ambiguity choices are listed in readings.md.
"""
import datetime as dt
import hashlib
import json
import os
from fractions import Fraction

HERE = os.path.dirname(os.path.abspath(__file__))

# Section 4.5 / 7.2: the five permitted factors, in the order Section 4.5 lists them.
FACTORS = ["mandate_scope", "intent_fidelity", "merchant_performance",
           "adjustments_already_made", "agent_platform_conduct"]
# Section 7.4 rule 1: only these completed adjustment types count.
COUNTED_ADJ_TYPES = {"refund", "credit", "price_adjustment"}
# Section 7.5: default window when the record does not carry window_days.
DEFAULT_WINDOW_DAYS = 120
# Section 7.5: signed determination within 10 calendar days.
DETERMINATION_DAYS = 10
# Section 4.5: required determination fields (schema required list).
DET_REQUIRED = ["determination_id", "dispute_id", "policy_version", "per_line",
                "factors", "prohibited_screened", "signer", "opened_at",
                "issued_at", "seal", "fee_disposition"]


# ---------------------------------------------------------------- helpers

def jcs(v):
    """RFC 8785 canonical JSON (Section 4.4a). Covers the value kinds the
    UserApproval schema admits: objects, arrays, strings, integers, bools, null."""
    if isinstance(v, dict):
        # RFC 8785: keys sorted by UTF-16 code units
        keys = sorted(v.keys(), key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + jcs(v[k]) for k in keys) + "}"
    if isinstance(v, list):
        return "[" + ",".join(jcs(x) for x in v) + "]"
    if isinstance(v, bool) or v is None:
        return json.dumps(v)
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        if v.is_integer() and abs(v) < 1e21:
            return str(int(v))
        return repr(v)
    return json.dumps(v, ensure_ascii=False)


def utc_date(v):
    """UTC calendar date of an epoch-seconds value, RFC 3339 string or YYYY-MM-DD."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(v, dt.timezone.utc).date()
    s = str(v)
    if len(s) == 10:
        return dt.date.fromisoformat(s)
    return parse_ts(s).date()


def parse_ts(s):
    if isinstance(s, (int, float)):
        return dt.datetime.fromtimestamp(s, dt.timezone.utc)
    s = str(s).replace("Z", "+00:00")
    t = dt.datetime.fromisoformat(s)
    if t.tzinfo is None:
        t = t.replace(tzinfo=dt.timezone.utc)
    return t.astimezone(dt.timezone.utc)


def line_amount(li):
    """Section 7.4 (last paragraph): subtotal; else unit_price x quantity.ordered."""
    if li.get("subtotal") is not None:
        return Fraction(li["subtotal"])
    if li.get("unit_price") is not None:
        q = (li.get("quantity") or {}).get("ordered")
        if q is None:
            return None
        return Fraction(li["unit_price"]) * q
    return None


def to_int(fr):
    """Minor units: round half up (readings.md)."""
    fr = Fraction(fr)
    return int((fr * 2 + 1) // 2)


# ---------------------------------------------------------------- eligibility

def check_eligibility(rec, opened_at):
    """Returns None when eligible, else a not_eligible code."""
    h = rec.get("checkout_hash")
    pm = rec.get("payment_mandate") or {}
    cr = rec.get("checkout_receipt") or {}
    pr = rec.get("payment_receipt") or {}
    # Section 4.4: transaction_id == checkout_hash and each receipt's reference ==
    # checkout_hash, exact string equality, no case or encoding normalization.
    if not (isinstance(h, str) and pm.get("transaction_id") == h
            and cr.get("reference") == h and pr.get("reference") == h):
        return "authorization_chain_broken"
    # Section 7.5: a receipt is eligible only when its status is success (both receipts).
    if cr.get("status") != "success" or pr.get("status") != "success":
        return "receipt_status"
    # Section 7.5 / 5.3: window counted in whole UTC calendar days from the UTC date of
    # payment_receipt.iat to the UTC date of opened_at; window_days default 120.
    if opened_at is not None and pr.get("iat") is not None:
        window = rec.get("window_days", DEFAULT_WINDOW_DAYS)
        days = (utc_date(opened_at) - utc_date(pr["iat"])).days
        if days > window or days < 0:
            return "outside_window"
    # Section 7.5: a disputed line with neither subtotal nor unit_price is ineligible.
    lines = {li.get("id"): li for li in (rec.get("order") or {}).get("line_items") or []}
    for lid in (rec.get("claim") or {}).get("line_ids") or []:
        li = lines.get(lid)
        if li is None or (li.get("subtotal") is None and li.get("unit_price") is None):
            return "line_amount_missing"
    return None


def approval_bound(rec, complete_digest):
    """Section 4.4a: recompute digest from {items, approved_at} (JCS, SHA-256, lowercase
    hex) and check it equals the approval_digest the merchant received on complete."""
    ua = rec.get("user_approval")
    if not ua:
        return None
    body = {"items": ua.get("items"), "approved_at": ua.get("approved_at")}
    digest = hashlib.sha256(jcs(body).encode("utf-8")).hexdigest()
    return digest == ua.get("approval_digest") and complete_digest is not None \
        and digest == complete_digest


# ---------------------------------------------------------------- decision rule

def allocate_adjustments(order, amounts):
    """Section 7.4 rule 1: per-line credit from completed refund/credit/price_adjustment.
    Line-labelled: in full to the named line (split pro rata by line amount when it names
    several). Unlabelled (order-level): pro rata by line amount over lines with a known amount."""
    credit = {lid: Fraction(0) for lid in amounts}
    known = {lid: a for lid, a in amounts.items() if a is not None}
    for adj in order.get("adjustments") or []:
        # Section 7.4 rule 1: only completed adjustments of the counted types.
        if adj.get("status") != "completed" or adj.get("type") not in COUNTED_ADJ_TYPES:
            continue
        amt = Fraction(adj.get("amount") or 0)
        named = [x.get("id") if isinstance(x, dict) else x for x in (adj.get("line_items") or [])]
        named = [n for n in named if n in amounts]
        if len(named) == 1:
            credit[named[0]] += amt  # counts in full
        else:
            pool = {n: known[n] for n in (named or known.keys()) if n in known}
            tot = sum(pool.values())
            if tot > 0:
                for n, a in pool.items():
                    credit[n] += amt * a / tot
    return credit


def order_charge(order, amounts):
    """Section 7.4 rule 2: the charge is the order total (totals entry of type 'total');
    without one, the sum of line amounts (readings.md)."""
    for t in order.get("totals") or []:
        if t.get("type") == "total" and t.get("amount") is not None:
            return Fraction(t["amount"])
    if all(a is not None for a in amounts.values()):
        return sum(amounts.values(), Fraction(0))
    return None


def decide(rec, as_of, bound):
    order = rec.get("order") or {}
    pm = rec.get("payment_mandate") or {}
    lines = order.get("line_items") or []
    amounts = {li.get("id"): line_amount(li) for li in lines}
    by_id = {li.get("id"): li for li in lines}
    credit = allocate_adjustments(order, amounts)
    charge = order_charge(order, amounts)
    pay_amt = pm.get("payment_amount")
    excess = None
    if charge is not None and pay_amt is not None and charge > Fraction(pay_amt):
        excess = charge - Fraction(pay_amt)
    known_total = sum(a for a in amounts.values() if a is not None)

    # Section 7.4 rule 2: execution after exp when UTC date(execution_date) > UTC date(exp).
    after_exp = False
    if pm.get("execution_date") is not None and pm.get("exp") is not None:
        after_exp = utc_date(pm["execution_date"]) > utc_date(pm["exp"])
    # Section 7.4 rule 2 / Open Question 12: mandate reuse has no field in the record.
    reused = bool(pm.get("reused"))  # never set by any schema field; placeholder only

    # Section 7.4 rule 3: estimated_delivery.latest of the order (not a fulfillment's).
    ed = order.get("estimated_delivery") or {}
    ed_latest = parse_ts(ed["latest"]) if ed.get("latest") else None
    ua = rec.get("user_approval") or {}

    out = []
    for lid in (rec.get("claim") or {}).get("line_ids") or []:
        li = by_id.get(lid, {})
        amt = amounts.get(lid)

        def res(outcome, amount, rule, finding=None):
            return {"line_id": lid, "outcome": outcome,
                    "amount": to_int(amount) if outcome == "overturn" else 0,
                    "rule": rule, "finding": finding}

        # Section 7.4 rule 1: completed counted refund/credit >= line amount -> uphold (moot).
        if amt is not None and credit.get(lid, 0) >= amt:
            out.append(res("uphold", 0, "1_moot"))
            continue
        # Section 7.4 rule 2: charge > mandate -> overturn the excess (allocated pro rata
        # by line amount over lines with a known amount, capped at the line amount).
        if excess is not None and amt is not None and known_total > 0:
            share = min(amt, excess * amt / known_total)
            out.append(res("overturn", share, "2_over_mandate"))
            continue
        # Section 7.4 rule 2: execution after exp, or reuse -> overturn the line.
        if after_exp or reused:
            out.append(res("overturn", amt, "2_after_exp"))
            continue
        # Section 7.4 rule 3: merchant canceled without a completed counted adjustment
        # (read per line: none allocated to this line) -> overturn the line.
        if order.get("status") == "canceled" and credit.get(lid, 0) == 0:
            out.append(res("overturn", amt, "3_canceled"))
            continue
        # Section 7.4 rule 3: unfulfilled units after the order's estimated_delivery.latest:
        # unfulfilled = (current else ordered) - fulfilled; overturn that share.
        q = li.get("quantity") or {}
        if ed_latest is not None and as_of is not None and parse_ts(as_of) > ed_latest and q:
            basis = q.get("current", q.get("ordered"))
            fulfilled = q.get("fulfilled", 0) or 0
            if basis and basis - fulfilled > 0:
                out.append(res("overturn", amt * (basis - fulfilled) / basis, "3_unfulfilled"))
                continue
        # Section 7.4 rule 4 with Section 4.4a: with a bound user_approval, a disputed line
        # whose sku or variant matches no approved item is a finding against the agent
        # platform; it does not reverse the charge.
        if bound:
            item = li.get("item") or {}
            sku, var = item.get("id", li.get("sku")), item.get("variant", li.get("variant"))
            match = any(a.get("sku") == sku and
                        ("variant" not in a or a.get("variant") == var)
                        for a in ua.get("items") or [])
            if not match:
                out.append(res("uphold", 0, "4_intent", "agent_platform"))
                continue
        # Section 7.4 rule 5: otherwise uphold.
        out.append(res("uphold", 0, "5_default"))
    return out


# ---------------------------------------------------------------- determination checks

def check_determination(det, rec, decided, eligible_code, opened_at_input):
    p = []
    # Section 4.5: required fields.
    for f in DET_REQUIRED:
        if f not in det:
            p.append("missing:" + f)
    # Section 4.5: dispute_id and policy_version must be those of the record.
    if "dispute_id" in det and det["dispute_id"] != rec.get("dispute_id"):
        p.append("dispute_id_differs")
    if "policy_version" in det and det["policy_version"] != rec.get("policy_version"):
        p.append("policy_version_differs")
    # Section 7.3: providers MUST screen and state it (prohibited_screened true).
    if "prohibited_screened" in det and det["prohibited_screened"] is not True:
        p.append("prohibited_not_screened")
    # Section 7.2: the five factors, nothing else; Section 4.5: all five present.
    factors = det.get("factors")
    if isinstance(factors, dict):
        for k in factors:
            if k not in FACTORS:
                p.append("factor_not_permitted:" + k)
        absent = [f for f in FACTORS if f not in factors]
        if absent:
            p.append("factors_absent:" + ",".join(absent))
    # Section 7.7: signed by a named natural person holding a published credential.
    if "signer" in det:
        s = det.get("signer") or {}
        if not (isinstance(s.get("name"), str) and s["name"].strip()
                and isinstance(s.get("credential"), str) and s["credential"].strip()):
            p.append("signer_incomplete")
    # Section 7.9: verifiable at seal.verify_url.
    seal = det.get("seal")
    if isinstance(seal, dict):
        for f in ("record_hash", "chain_head", "verify_url"):
            if not seal.get(f):
                p.append("missing:seal." + f)
    # Section 7.5: opened_at returned is the time the provider received the record.
    if opened_at_input is not None and det.get("opened_at") is not None \
            and parse_ts(opened_at_input) != parse_ts(det["opened_at"]):
        p.append("opened_at_differs")
    # Section 7.5: signed determination within 10 calendar days of opening.
    if det.get("opened_at") and det.get("issued_at"):
        d = (utc_date(det["issued_at"]) - utc_date(det["opened_at"])).days
        if d < 0 or d > DETERMINATION_DAYS:
            p.append("issued_outside_clock")
    # Sections 4.4 / 7.5: an ineligible record cannot carry a determination.
    if eligible_code is not None:
        p.append("record_not_eligible:" + eligible_code)
    else:
        # Section 7.4: per-line outcome and amount must be what the rule gives.
        mine = {x["line_id"]: x for x in decided}
        theirs = {x.get("line_id"): x for x in det.get("per_line") or []}
        for lid, m in mine.items():
            t = theirs.get(lid)
            if t is None:
                p.append("line_missing:" + lid)
            elif t.get("outcome") != m["outcome"]:
                p.append("outcome_differs:" + lid)
            elif m["outcome"] == "overturn" and (t.get("amount") or {}).get("amount") != m["amount"]:
                p.append("amount_differs:" + lid)
        for lid in theirs:
            if lid not in mine:
                p.append("line_not_disputed:" + lid)
        # Section 7.6: loser pays. Merchant loses if any line is overturned; else payer.
        loser = "merchant" if any(x["outcome"] == "overturn" for x in decided) else "payer"
        fd = det.get("fee_disposition") or {}
        if "fee_disposition" in det and fd.get("paid_by") != loser:
            p.append("fee_paid_by_differs")
    return p


# ---------------------------------------------------------------- driver

def run_case(case):
    inp = case["input"]
    rec = inp["record"]
    det = inp.get("determination")
    # Section 7.5: opened_at is the time the provider received the record; taken from
    # input.opened_at, else from the determination under check.
    opened_at = inp.get("opened_at") or (det or {}).get("opened_at")
    out = {}
    code = check_eligibility(rec, opened_at)
    out["eligible"] = code is None
    if code is not None:
        out["not_eligible"] = code
    bound = approval_bound(rec, inp.get("complete_digest"))
    if bound is not None:
        out["approval_bound"] = bound
    decided = []
    if code is None:
        # Section 7.4 unfulfilled check needs an assessment time: as_of, else opened_at.
        decided = decide(rec, inp.get("as_of") or opened_at, bool(bound))
        out["per_line"] = decided
    if det is not None:
        probs = check_determination(det, rec, decided, code, inp.get("opened_at"))
        out["det_ok"] = not probs
        out["det_problems"] = probs
    return out


def main():
    with open(os.path.join(HERE, "inputs.json")) as f:
        cases = json.load(f)
    results = {c["id"]: run_case(c) for c in cases}
    with open(os.path.join(HERE, "results.json"), "w") as f:
        json.dump(results, f, indent=2)
        f.write("\n")
    print(len(results), "cases")


if __name__ == "__main__":
    main()
