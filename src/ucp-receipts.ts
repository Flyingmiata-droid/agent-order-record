// Stripe webhook events to UCP AP2 order receipts.
// Follows the Order Receipts section of the AP2 Mandates extension as proposed
// in Universal-Commerce-Protocol/ucp PR 1109 (read at fc59727). That text is a
// proposal and still moving. Recheck this file when it changes.
//
// This code reads Stripe event objects the caller already holds and signs
// receipts with a key the caller supplies. It never calls Stripe.
//
// Stripe field names come from the public API reference (Refund, Charge,
// PaymentIntent objects) and the capture, multicapture, overcapture and refund
// guides. The test event shapes are hand built from those pages, not captured
// from a live account.
import { createHash, createPrivateKey, sign } from 'node:crypto';
import type { JsonWebKey } from 'node:crypto';
import { canonicalize } from './jcs.ts';

export const RECEIPT_TYP = 'ucp-ap2-receipt+jwt';

export type ReceiptEventType =
  | 'authorization' | 'authorization_adjustment' | 'capture'
  | 'capture_reversal' | 'release' | 'refund';
export type ReceiptStatus = 'pending' | 'succeeded' | 'failed';

export interface ReceiptEvent {
  type: ReceiptEventType;
  status: ReceiptStatus;
  amount: number;
  currency: string;
  occurred_at: string;
  network_ref?: string;
  ref?: { processing_entry_id?: string; adjustment_id?: string };
}

export interface ReceiptTotals { mandated: number; authorized: number; captured: number; refunded: number }

export interface ReceiptPayload {
  iss: string;
  order_id: string;
  checkout_id?: string;
  mandate_ref: string;
  iat: number;
  seq: number;
  prev: string | null;
  event: ReceiptEvent;
  totals: ReceiptTotals;
}

// The parts of Stripe objects this adapter reads. Extra members are ignored.
export interface StripeCharge {
  id: string;
  object: 'charge';
  amount: number;
  amount_captured: number;
  captured: boolean;
  currency: string;
  created: number;
  payment_intent?: string | null;
  payment_method_details?: { card?: { amount_authorized?: number | null } | null } | null;
}
export interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  amount_capturable: number;
  amount_received: number;
  currency: string;
  status: string;
  cancellation_reason?: string | null;
}
export interface StripeRefund {
  id: string;
  object: 'refund';
  amount: number;
  currency: string;
  created: number;
  status: 'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled' | null;
  metadata?: Record<string, string> | null;
  destination_details?: {
    type?: string;
    card?: {
      reference?: string | null;
      reference_status?: 'pending' | 'available' | 'unavailable' | null;
      reference_type?: string | null;
      type?: 'pending' | 'refund' | 'reversal';
    } | null;
  } | null;
}
export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: StripeCharge | StripePaymentIntent | StripeRefund | { id?: string; object: string } };
}

export interface ReceiptContext {
  // Profile URI of the business that signs. Must be the business the mandate covers.
  iss: string;
  order_id: string;
  checkout_id?: string;
  // The Payment Mandate exactly as sent in payment.instruments[*].credential.token.
  // Only its hash goes into a receipt.
  mandateToken: string;
  // payment_amount of that mandate, minor units.
  mandated: number;
  // ES256 private key as a JWK, and the kid it resolves to in the business profile keys.
  privateJwk: JsonWebKey;
  kid: string;
  // Order adjustment a refund belongs to. Default reads refund.metadata.ucp_adjustment_id.
  adjustmentFor?: (refund: StripeRefund) => string | undefined;
  // Overcapture puts captured above authorized with no new network authorization.
  // The spec text has no event for that. 'hold' (default) signs nothing for the
  // capture and reports it. 'adjust' signs an authorization_adjustment for the
  // difference first, which is this adapter's reading, not the spec's.
  overcapture?: 'hold' | 'adjust';
}

export type UnmappedReason =
  | 'dispute_out_of_scope'
  | 'refund_failed_after_succeeded'
  | 'overcapture_held'
  | 'would_exceed_mandate'
  | 'refund_would_exceed_capture'
  | 'chain_halted'
  | 'refund_requires_action'
  | 'event_not_a_money_movement';

export interface Unmapped { event_id: string; event_type: string; reason: UnmappedReason; detail: string }

export interface ReceiptChain {
  // True once a real money movement could not be receipted. Nothing is signed after
  // that point, because every later total would be knowingly wrong.
  halted: boolean;
  receipts: string[];
  payloads: ReceiptPayload[];
  unmapped: Unmapped[];
  totals: ReceiptTotals;
}

export function sha256Ref(artifact: string): string {
  return 'sha-256:' + createHash('sha256').update(artifact, 'utf8').digest('base64url');
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace('.000Z', 'Z');
}

interface RefundState { pending: boolean; succeeded: boolean; failed: boolean; networkRef: boolean }

// Turns Stripe events, in the order received, into one signed receipt chain.
// Amounts are tracked as running state, so a repeated or late event signs nothing twice.
export function stripeToReceipts(events: StripeEvent[], ctx: ReceiptContext): ReceiptChain {
  const key = createPrivateKey({ key: ctx.privateJwk, format: 'jwk' });
  const mandateRef = sha256Ref(ctx.mandateToken);
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: ctx.kid, typ: RECEIPT_TYP })).toString('base64url');
  const out: ReceiptChain = {
    halted: false, receipts: [], payloads: [], unmapped: [],
    totals: { mandated: ctx.mandated, authorized: 0, captured: 0, refunded: 0 },
  };
  const refunds = new Map<string, RefundState>();
  let released = false;

  const HALTING: UnmappedReason[] = ['overcapture_held', 'would_exceed_mandate', 'refund_would_exceed_capture', 'refund_failed_after_succeeded'];
  const hold = (e: StripeEvent, reason: UnmappedReason, detail: string): void => {
    out.unmapped.push({ event_id: e.id, event_type: e.type, reason, detail });
    if (HALTING.includes(reason)) out.halted = true;
  };

  type Draft = ReceiptEvent & { network_ref_only?: boolean };
  const emit = (e: StripeEvent, event: Draft): void => {
    const t = out.totals;
    if (event.status === 'succeeded' && !event.network_ref_only) {
      if (event.type === 'authorization' || event.type === 'authorization_adjustment') t.authorized += event.amount;
      if (event.type === 'release') t.authorized -= event.amount;
      if (event.type === 'capture') t.captured += event.amount;
      if (event.type === 'capture_reversal') t.captured -= event.amount;
      if (event.type === 'refund') t.refunded += event.amount;
    }
    delete event.network_ref_only;
    const payload: ReceiptPayload = {
      iss: ctx.iss,
      order_id: ctx.order_id,
      ...(ctx.checkout_id ? { checkout_id: ctx.checkout_id } : {}),
      mandate_ref: mandateRef,
      iat: e.created,
      seq: out.receipts.length + 1,
      prev: out.receipts.length ? sha256Ref(out.receipts[out.receipts.length - 1]) : null,
      event,
      totals: { ...t },
    };
    const signingInput = header + '.' + Buffer.from(canonicalize(payload), 'utf8').toString('base64url');
    const sig = sign('sha256', Buffer.from(signingInput, 'ascii'), { key, dsaEncoding: 'ieee-p1363' });
    out.receipts.push(signingInput + '.' + sig.toString('base64url'));
    out.payloads.push(payload);
  };

  const base = (type: ReceiptEventType, status: ReceiptStatus, amount: number, currency: string, at: number, entry: string): Draft => ({
    type, status, amount, currency: currency.toUpperCase(), occurred_at: iso(at), ref: { processing_entry_id: entry },
  });

  // Brings the authorized total up to `target`. First time is an authorization, later an adjustment.
  const authorizeTo = (e: StripeEvent, target: number, currency: string, at: number, entry: string): boolean => {
    const t = out.totals;
    const delta = target - t.authorized;
    if (delta <= 0) return true;
    if (target > ctx.mandated) {
      hold(e, 'would_exceed_mandate', `authorized would be ${target}, mandate covers ${ctx.mandated}; a new Payment Mandate is needed first`);
      return false;
    }
    const first = t.authorized === 0 && !out.payloads.some((p) => p.event.type === 'authorization');
    emit(e, base(first ? 'authorization' : 'authorization_adjustment', 'succeeded', delta, currency, at,
      entry + (first ? ':auth' : ':auth:' + target)));
    return true;
  };

  const captureTo = (e: StripeEvent, ch: StripeCharge, at: number): void => {
    const t = out.totals;
    const delta = ch.amount_captured - t.captured;
    if (delta <= 0) return;
    if (ch.amount_captured > ctx.mandated) {
      hold(e, 'would_exceed_mandate', `captured would be ${ch.amount_captured}, mandate covers ${ctx.mandated}`);
      return;
    }
    if (ch.amount_captured > t.authorized) {
      if (ctx.overcapture !== 'adjust') {
        hold(e, 'overcapture_held', `captured ${ch.amount_captured} is above authorized ${t.authorized} with no new network authorization`);
        return;
      }
      if (!authorizeTo(e, ch.amount_captured, ch.currency, at, ch.id)) return;
    }
    emit(e, base('capture', 'succeeded', delta, ch.currency, at, ch.id + ':cap:' + ch.amount_captured));
  };

  const releaseRest = (e: StripeEvent, currency: string, at: number, entry: string): void => {
    const t = out.totals;
    const rest = t.authorized - t.captured;
    if (rest <= 0 || released) return;
    released = true;
    emit(e, base('release', 'succeeded', rest, currency, at, entry + ':release'));
  };

  for (const e of events) {
    const obj = e.data.object;
    if (e.type.startsWith('charge.dispute.')) {
      hold(e, 'dispute_out_of_scope', 'disputes and chargebacks are out of scope in the Order Receipts text');
      continue;
    }
    if (out.halted) {
      hold(e, 'chain_halted', 'an earlier movement could not be receipted; fix that first');
      continue;
    }
    if (obj.object === 'charge' && (e.type === 'charge.succeeded' || e.type === 'charge.captured' || e.type === 'charge.updated')) {
      const ch = obj as StripeCharge;
      const authorized = ch.payment_method_details?.card?.amount_authorized ?? ch.amount;
      if (!authorizeTo(e, Math.max(authorized, out.totals.authorized), ch.currency, ch.created, ch.id)) continue;
      if (ch.captured) captureTo(e, ch, e.created);
      continue;
    }
    if (obj.object === 'payment_intent') {
      const pi = obj as StripePaymentIntent;
      if (e.type === 'payment_intent.amount_capturable_updated') {
        // Incremental authorization raises amount_capturable on an uncaptured intent.
        if (out.totals.captured === 0) authorizeTo(e, pi.amount_capturable, pi.currency, e.created, pi.id);
        continue;
      }
      if (e.type === 'payment_intent.succeeded') {
        // A partial capture releases the uncaptured rest unless multicapture keeps it open.
        releaseRest(e, pi.currency, e.created, pi.id);
        continue;
      }
      if (e.type === 'payment_intent.canceled') {
        releaseRest(e, pi.currency, e.created, pi.id);
        continue;
      }
    }
    if (obj.object === 'charge' && e.type === 'charge.expired') {
      releaseRest(e, (obj as StripeCharge).currency, e.created, (obj as StripeCharge).id);
      continue;
    }
    if (obj.object === 'refund') {
      const r = obj as StripeRefund;
      const st = refunds.get(r.id) ?? { pending: false, succeeded: false, failed: false, networkRef: false };
      refunds.set(r.id, st);
      const card = r.destination_details?.card;
      const ref = card?.reference_status === 'available' && card.reference ? card.reference : undefined;
      const adj = ctx.adjustmentFor ? ctx.adjustmentFor(r) : r.metadata?.ucp_adjustment_id;
      const make = (status: ReceiptStatus): Draft => {
        const ev = base('refund', status, r.amount, r.currency, status === 'pending' ? r.created : e.created, r.id);
        if (adj) ev.ref = { ...ev.ref, adjustment_id: adj };
        return ev;
      };
      if (r.status === 'requires_action') {
        hold(e, 'refund_requires_action', 'refund waits on the customer; nothing has moved');
      } else if (r.status === 'pending') {
        if (!st.pending && !st.succeeded) { st.pending = true; emit(e, make('pending')); }
      } else if (r.status === 'succeeded') {
        if (!st.succeeded) {
          if (out.totals.refunded + r.amount > out.totals.captured) {
            hold(e, 'refund_would_exceed_capture', `refunded would be ${out.totals.refunded + r.amount}, captured is ${out.totals.captured}`);
            continue;
          }
          st.succeeded = true;
          const ev = make('succeeded');
          if (ref) { ev.network_ref = ref; st.networkRef = true; }
          emit(e, ev);
        } else if (ref && !st.networkRef) {
          // Late ARN: same type and processing_entry_id, totals do not move again.
          st.networkRef = true;
          const ev = make('succeeded');
          ev.network_ref = ref;
          ev.network_ref_only = true;
          emit(e, ev);
        }
      } else if (r.status === 'failed' || r.status === 'canceled') {
        if (st.succeeded) {
          if (!st.failed) {
            st.failed = true;
            hold(e, 'refund_failed_after_succeeded', `refund ${r.id} was receipted as succeeded and then ${r.status}; no receipt event lowers refunded`);
          }
        } else if (!st.failed) {
          st.failed = true;
          emit(e, make('failed'));
        }
      }
      continue;
    }
    hold(e, 'event_not_a_money_movement', 'no receipt event for this Stripe event');
  }
  return out;
}
