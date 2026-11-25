## Stripe events to UCP order receipts

`src/ucp-receipts.ts` takes Stripe webhook events for one payment and signs the receipt chain that the AP2 Mandates extension describes in its Order Receipts section. That section is a proposal, Universal-Commerce-Protocol/ucp PR 1109. This code follows commit 0110eac and will need a recheck when the text moves.

It does not call Stripe. You pass in events you already hold and an ES256 key.

### What has been checked and what has not

The 13 scenarios in `test/fixtures/stripe-events/scenarios.ts` were run through a verifier this repo did not write: `common/payments/ap2_receipt_verifier.py` from conformance PR 136, at 1b94f82. All 13 came back with no outcome, warning or reconciliation finding. `run_verifier.py` in this folder repeats that run.

Six flows were then captured from a Stripe sandbox with `scripts/ucp-capture.ts` and saved in `test/fixtures/stripe-events/captured`: automatic capture, manual partial capture, cancel before capture, a partial refund with its ARN, a refund that starts pending, and a refund on Stripe's test card for failed refunds. Receipts built from those real events also pass the verifier, 19 files in all.

The captures changed the code. Stripe sent several events inside the same second, and the first version of the adapter got three of the six wrong when they were read in a different order. It now tracks amounts as running marks and gives the same receipts either way round. The test runs every captured flow both ways.

Still not captured: multicapture, incremental authorization and overcapture. The sandbox account is not eligible for those card features, so their scenarios stay hand built from Stripe's guides. The two late refund outcomes (pending to succeeded, succeeded to failed) had not arrived when the capture ran; `node scripts/ucp-capture.ts --recheck` reads them later.

### How Stripe events map

| Stripe event | What it means on the card | Receipt |
| :-- | :-- | :-- |
| `charge.succeeded`, `captured` false | hold placed | `authorization` |
| `charge.succeeded`, `captured` true | hold and capture together | `authorization`, then `capture` |
| `payment_intent.amount_capturable_updated`, amount went up | incremental authorization | `authorization_adjustment` for the difference |
| `charge.captured` | capture, or the next capture under multicapture | `capture` for the newly captured amount |
| `payment_intent.succeeded` with part of the hold uncaptured | Stripe drops the rest of the hold | `release` for the rest |
| `payment_intent.canceled`, `charge.expired` | hold voided or expired | `release` |
| refund with status `pending` | refund sent, not settled | `refund`, `pending` |
| refund with status `succeeded` | refund settled, as a refund or as a reversal | `refund`, `succeeded` |
| refund update where `reference_status` turns `available` | the ARN arrived later | second `refund`, `succeeded`, same `processing_entry_id`, with `network_ref` |
| refund `failed` or `canceled` before it succeeded | refund did not happen | `refund`, `failed` |
| refund `failed` or `canceled` after it succeeded | the bank sent the money back | `refund_reversal`, `succeeded`, same `processing_entry_id` |
| capture above the authorized amount (overcapture) | Stripe captured more than the hold | `authorization_adjustment` for the gap, then `capture` |

The refund id is always the `processing_entry_id`, so a late ARN can be tied to its refund. A refund that Stripe settles as a reversal (`destination_details.card.type` is `reversal`) never gets a `network_ref`.

Nothing from Stripe maps to `capture_reversal`. On cards, Stripe reports an undone capture as a refund whose type settles to `reversal`, and the spec text says to receipt that as a `refund`.

### Two flows the spec now covers

Overcapture and a refund that fails after it succeeded had no receipt event at fc59727, so the adapter stopped the chain on both. After this repo raised them on PR 1109, 0110eac added both to Edge Cases: overcapture gets an `authorization_adjustment` for the gap first, and a returned refund gets a `refund_reversal` with the same `event.ref`, which lowers `refunded`. The adapter does both by default now. `overcapture: 'hold'` keeps the old stop-the-chain behavior for anyone who wants it.

The conformance verifier at 1b94f82 predated `refund_reversal` and read that one scenario as malformed. The PR 136 branch now handles it. Rerun on 2026-11-23 at 714f50b, which follows ucp PR 1109 at c21cdc3 and adds the check that `captured` stays at or below `authorized`: 19 of 19 files clean.

Disputes are reported in `unmapped` too, without stopping the chain. The spec puts them out of scope.

### Run it

```
npm test
node scripts/ucp-export.ts /tmp/ucp-out
python3 conformance/ucp-order-receipts/run_verifier.py <checkout of conformance PR 136> /tmp/ucp-out
```
