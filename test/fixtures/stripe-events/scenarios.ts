// Stripe event sequences for the receipt adapter tests.
// HAND BUILT from Stripe's public API reference and guides (read 2026-11-21):
// Refund object (status, destination_details.card.type, reference,
// reference_status), capture later (partial capture releases the rest),
// multicapture (final_capture false), overcapture, incremental authorization,
// failed refunds. Only the members the adapter reads are present.
// These are not captures from a live or test mode account.
import type { StripeEvent } from '../../../src/ucp-receipts.ts';

const T0 = 1794236000; // 2026-11-09T14:53:20Z
let n = 0;
const ev = (type: string, at: number, object: Record<string, unknown>): StripeEvent =>
  ({ id: 'evt_test_' + String(++n).padStart(3, '0'), type, created: at, data: { object } } as StripeEvent);

const charge = (o: { authorized: number; captured: number; isCaptured: boolean; amount?: number }) => ({
  id: 'ch_test_1', object: 'charge', amount: o.amount ?? o.authorized, amount_captured: o.captured, captured: o.isCaptured,
  currency: 'usd', created: T0, payment_intent: 'pi_test_1',
  payment_method_details: { card: { amount_authorized: o.authorized } },
});
const pi = (status: string, o: { amount: number; capturable: number; received: number }) => ({
  id: 'pi_test_1', object: 'payment_intent', amount: o.amount, amount_capturable: o.capturable,
  amount_received: o.received, currency: 'usd', status,
});
const refund = (id: string, amount: number, status: string, card: Record<string, unknown>, created: number, adj?: string) => ({
  id, object: 'refund', amount, currency: 'usd', created, status,
  metadata: adj ? { ucp_adjustment_id: adj } : {},
  destination_details: { type: 'card', card },
});

export interface Scenario {
  name: string;
  mandated: number;
  events: StripeEvent[];
  overcapture?: 'hold' | 'adjust';
  // Expected receipt events, as "type:status:amount".
  expect: string[];
  expectUnmapped: string[];
  expectTotals: { authorized: number; captured: number; refunded: number };
  adjustments?: Array<{ id: string; total: number }>;
}

export const scenarios: Scenario[] = [
  {
    name: 'auto_capture',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 5400, isCaptured: true })),
      ev('payment_intent.succeeded', T0 + 1, pi('succeeded', { amount: 5400, capturable: 0, received: 5400 })),
    ],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:5400'],
    expectUnmapped: [],
    expectTotals: { authorized: 5400, captured: 5400, refunded: 0 },
  },
  {
    name: 'manual_partial_capture_releases_rest',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 0, isCaptured: false })),
      ev('payment_intent.amount_capturable_updated', T0, pi('requires_capture', { amount: 5400, capturable: 5400, received: 0 })),
      ev('charge.captured', T0 + 40000, charge({ authorized: 5400, captured: 3000, isCaptured: true })),
      ev('payment_intent.succeeded', T0 + 40000, pi('succeeded', { amount: 5400, capturable: 0, received: 3000 })),
    ],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:3000', 'release:succeeded:2400'],
    expectUnmapped: [],
    expectTotals: { authorized: 3000, captured: 3000, refunded: 0 },
  },
  {
    name: 'multicapture_two_shipments',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 0, isCaptured: false })),
      ev('charge.captured', T0 + 40000, charge({ authorized: 5400, captured: 3000, isCaptured: true })),
      ev('charge.captured', T0 + 212800, charge({ authorized: 5400, captured: 5400, isCaptured: true })),
      ev('payment_intent.succeeded', T0 + 212800, pi('succeeded', { amount: 5400, capturable: 0, received: 5400 })),
    ],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:3000', 'capture:succeeded:2400'],
    expectUnmapped: [],
    expectTotals: { authorized: 5400, captured: 5400, refunded: 0 },
  },
  {
    name: 'incremental_authorization_then_capture',
    mandated: 7000,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 0, isCaptured: false })),
      ev('payment_intent.amount_capturable_updated', T0 + 3600, pi('requires_capture', { amount: 6500, capturable: 6500, received: 0 })),
      ev('charge.captured', T0 + 7200, charge({ authorized: 6500, captured: 6500, isCaptured: true, amount: 6500 })),
    ],
    expect: ['authorization:succeeded:5400', 'authorization_adjustment:succeeded:1100', 'capture:succeeded:6500'],
    expectUnmapped: [],
    expectTotals: { authorized: 6500, captured: 6500, refunded: 0 },
  },
  {
    name: 'canceled_before_capture',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 0, isCaptured: false })),
      ev('payment_intent.canceled', T0 + 600, pi('canceled', { amount: 5400, capturable: 0, received: 0 })),
    ],
    expect: ['authorization:succeeded:5400', 'release:succeeded:5400'],
    expectUnmapped: [],
    expectTotals: { authorized: 0, captured: 0, refunded: 0 },
  },
  {
    name: 'refund_settles_as_reversal_no_arn',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 5400, isCaptured: true })),
      ev('refund.created', T0 + 7200, refund('re_test_1', 5400, 'pending', { type: 'pending', reference_status: 'pending' }, T0 + 7200, 'adj_refund_1')),
      ev('refund.updated', T0 + 7320, refund('re_test_1', 5400, 'succeeded', { type: 'reversal', reference_status: 'unavailable' }, T0 + 7200, 'adj_refund_1')),
    ],
    adjustments: [{ id: 'adj_refund_1', total: -5400 }],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:5400', 'refund:pending:5400', 'refund:succeeded:5400'],
    expectUnmapped: [],
    expectTotals: { authorized: 5400, captured: 5400, refunded: 5400 },
  },
  {
    name: 'refund_succeeds_then_late_arn',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 5400, isCaptured: true })),
      ev('refund.created', T0 + 86400, refund('re_test_1', 2000, 'succeeded', { type: 'refund', reference_status: 'pending' }, T0 + 86400, 'adj_refund_1')),
      ev('refund.updated', T0 + 86400 * 5, refund('re_test_1', 2000, 'succeeded',
        { type: 'refund', reference: '74000000000000000001063', reference_status: 'available', reference_type: 'acquirer_reference_number' }, T0 + 86400, 'adj_refund_1')),
      // Stripe redelivers the same update: nothing new is signed.
      ev('refund.updated', T0 + 86400 * 5 + 5, refund('re_test_1', 2000, 'succeeded',
        { type: 'refund', reference: '74000000000000000001063', reference_status: 'available', reference_type: 'acquirer_reference_number' }, T0 + 86400, 'adj_refund_1')),
    ],
    adjustments: [{ id: 'adj_refund_1', total: -2000 }],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:5400', 'refund:succeeded:2000', 'refund:succeeded:2000'],
    expectUnmapped: [],
    expectTotals: { authorized: 5400, captured: 5400, refunded: 2000 },
  },
  {
    name: 'refund_fails_while_pending',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 5400, isCaptured: true })),
      ev('refund.created', T0 + 7200, refund('re_test_1', 5400, 'pending', { type: 'pending', reference_status: 'pending' }, T0 + 7200)),
      ev('refund.failed', T0 + 9000, refund('re_test_1', 5400, 'failed', { type: 'pending', reference_status: 'unavailable' }, T0 + 7200)),
    ],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:5400', 'refund:pending:5400', 'refund:failed:5400'],
    expectUnmapped: [],
    expectTotals: { authorized: 5400, captured: 5400, refunded: 0 },
  },
  {
    name: 'refund_fails_after_succeeded_reversed',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 5400, isCaptured: true })),
      ev('refund.created', T0 + 7200, refund('re_test_1', 5400, 'succeeded', { type: 'refund', reference_status: 'pending' }, T0 + 7200)),
      ev('refund.failed', T0 + 86400 * 20, refund('re_test_1', 5400, 'failed', { type: 'refund', reference_status: 'unavailable' }, T0 + 7200)),
      ev('refund.created', T0 + 86400 * 21, refund('re_test_2', 5400, 'succeeded', { type: 'refund', reference_status: 'pending' }, T0 + 86400 * 21)),
    ],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:5400', 'refund:succeeded:5400', 'refund_reversal:succeeded:5400', 'refund:succeeded:5400'],
    expectUnmapped: [],
    expectTotals: { authorized: 5400, captured: 5400, refunded: 5400 },
  },
  {
    name: 'overcapture_held_when_asked',
    mandated: 6000,
    overcapture: 'hold',
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5000, captured: 0, isCaptured: false })),
      ev('charge.captured', T0 + 3600, charge({ authorized: 5000, captured: 5800, isCaptured: true })),
      ev('payment_intent.succeeded', T0 + 3600, pi('succeeded', { amount: 5800, capturable: 0, received: 5800 })),
    ],
    expect: ['authorization:succeeded:5000'],
    expectUnmapped: ['overcapture_held', 'chain_halted'],
    expectTotals: { authorized: 5000, captured: 0, refunded: 0 },
  },
  {
    name: 'overcapture_adjusts_by_default',
    mandated: 6000,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5000, captured: 0, isCaptured: false })),
      ev('charge.captured', T0 + 3600, charge({ authorized: 5000, captured: 5800, isCaptured: true })),
    ],
    expect: ['authorization:succeeded:5000', 'authorization_adjustment:succeeded:800', 'capture:succeeded:5800'],
    expectUnmapped: [],
    expectTotals: { authorized: 5800, captured: 5800, refunded: 0 },
  },
  {
    name: 'capture_above_mandate_held',
    mandated: 5400,
    overcapture: 'adjust',
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 0, isCaptured: false })),
      ev('charge.captured', T0 + 3600, charge({ authorized: 5400, captured: 6000, isCaptured: true })),
    ],
    expect: ['authorization:succeeded:5400'],
    expectUnmapped: ['would_exceed_mandate'],
    expectTotals: { authorized: 5400, captured: 0, refunded: 0 },
  },
  {
    name: 'dispute_is_reported_not_signed',
    mandated: 5400,
    events: [
      ev('charge.succeeded', T0, charge({ authorized: 5400, captured: 5400, isCaptured: true })),
      ev('charge.dispute.created', T0 + 86400 * 30, { id: 'dp_test_1', object: 'dispute' }),
    ],
    expect: ['authorization:succeeded:5400', 'capture:succeeded:5400'],
    expectUnmapped: ['dispute_out_of_scope'],
    expectTotals: { authorized: 5400, captured: 5400, refunded: 0 },
  },
];
