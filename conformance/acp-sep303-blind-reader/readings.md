# Readings taken where the RFC is ambiguous

One line each: section, the open point, the reading reader.py takes.

- 7.5 / 4.1: the DisputeRecord carries no window_days; the policy default of 120 days is used (Open Question 9).
- 7.5: when neither input.opened_at nor a determination opened_at is given, the window cannot be counted and is treated as met.
- 7.5: opened_at comes from input.opened_at, else from the determination under check; day 120 is inside a 120 day window, day 121 is outside.
- 7.5: "a receipt is eligible only when its status is success" applies to both checkout_receipt and payment_receipt; a missing status is not success.
- 4.4 / 7.5: eligibility checks run in the order chain, receipt status, window, line amount; the first failure is the reported code.
- 7.5: a disputed line id that is absent from order.line_items is reported as line_amount_missing.
- 7.4: rules are applied in order per line and the first rule that matches decides the line.
- 7.4 rule 1: an adjustment that names several lines is split pro rata by line amount over the lines it names; naming one line counts in full.
- 7.4 rule 1: pro rata shares are kept as exact fractions for the moot comparison; no rounding before comparing.
- 7.4 rule 3: "canceled without a completed adjustment of a type counted in rule 1" is read per line: the rule fires only when no counted completed adjustment is allocated to that line. A line with a partial allocation (order level refund smaller than its share) is neither moot nor canceled-without-adjustment and falls to rule 5 (D4d).
- 7.4 rule 3 canceled: the overturn amount is the full line amount.
- 7.4 rule 2: when the order has no totals entry of type total, the charge is the sum of line amounts.
- 7.4 rule 2: the excess over the mandate is allocated to each disputed line pro rata by line amount over all lines with a known amount, capped at the line amount.
- 7.4 rule 2: exp is epoch seconds and execution_date is a date; both compared as UTC calendar dates, strictly later is after.
- 7.4 rule 3 unfulfilled: assessed at input.as_of, else at opened_at; without either, or without order.estimated_delivery.latest, the rule cannot fire.
- 7.4 rule 3 unfulfilled: the share is line amount times unfulfilled over quantity.current (else quantity.ordered); minor units rounded half up.
- 7.4 rule 4 / 4.4a: a line's sku is line_item.item.id and its variant is line_item.item.variant; an approved item with no variant matches any variant of that sku.
- 7.4 rule 4 / 4.4a: rule 4 is decided only on a bound approval; an unbound approval (digest mismatch or recompute failure) is not evidence, the RFC gives no mechanical test for a platform statement, so the line falls to rule 5 with no finding (D8b, D8d).
- 4.4a: approval_bound needs both the recomputed digest to equal user_approval.approval_digest and to equal the digest received on complete (input.complete_digest); a missing complete digest is not bound.
- 7.6: "loser pays" is read per determination: the merchant pays if any disputed line is overturned, otherwise the payer pays, regardless of who is claimant.
- 4.5 / 7.2: factors_absent lists the missing names comma joined in Section 4.5 order.
- 4.5 / 7.7: a signer with an empty or blank name or credential is signer_incomplete, not missing.
- 7.4 / 4.5: when outcome matches but an overturn amount differs, the code is amount_differs:<line> (invented code); extra or missing lines give line_not_disputed:<line> and line_missing:<line> (invented codes).
- 4.5: the determination dispute_id and policy_version must equal the record's (dispute_id_differs, policy_version_differs, invented codes).
- 7.5: issued_at more than 10 UTC calendar days after opened_at gives issued_outside_clock (invented code); a determination opened_at that differs from input.opened_at gives opened_at_differs (invented code).
- 7.3: a prohibited consideration placed in factors (party_reputation) is reported as factor_not_permitted only; prohibited_screened true is taken at face value.
- 7.4 / 7.5: eligibility output is emitted for every case, including determination cases, because every case carries a record.

# Not implemented

- 7.4 rule 2 mandate reuse: no record field shows reuse (Open Question 12).
- 7.4a evidence packs: no case carries a pack or verifier output.
- 4.1 / 7.6: fee amount cannot be checked; the session fee is not in the record.
- 7.4 rule 2 payee scope, 7.7 drafted_by disclosure, 7.8 independence, 7.9 forever verification, 7.10 transparency: not observable from a record.
