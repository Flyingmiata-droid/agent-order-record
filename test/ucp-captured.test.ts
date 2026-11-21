// Runs the adapter over events captured from a Stripe sandbox by
// scripts/ucp-capture.ts. Stripe does not promise delivery order, so each flow
// is also run with same-second events reversed and must end in the same place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripeToReceipts } from '../src/ucp-receipts.ts';
import type { StripeEvent } from '../src/ucp-receipts.ts';

const dir = join(import.meta.dirname, 'fixtures', 'stripe-events', 'captured');
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const run = (events: StripeEvent[]) => stripeToReceipts(events, {
  iss: 'https://merchant.example/.well-known/ucp', order_id: 'order_captured', mandateToken: 'test_only_payment_mandate_captured',
  mandated: 5400, privateJwk: privateKey.export({ format: 'jwk' }), kid: 'test_only_adapter',
});
const tiesReversed = (events: StripeEvent[]): StripeEvent[] => {
  const groups = new Map<number, StripeEvent[]>();
  for (const e of events) groups.set(e.created, [...(groups.get(e.created) ?? []), e]);
  return [...groups.keys()].sort((a, b) => a - b).flatMap((k) => groups.get(k)!.slice().reverse());
};
const shape = (c: ReturnType<typeof run>) => ({
  totals: c.totals, halted: c.halted,
  movements: [...new Set(c.payloads.map((p) => `${p.event.type}:${p.event.status}:${p.event.amount}`))].sort(),
});

const expected: Record<string, { authorized: number; captured: number; movements: string[] }> = {
  auto_capture: { authorized: 5400, captured: 5400, movements: ['authorization:succeeded:5400', 'capture:succeeded:5400'] },
  manual_partial_capture: { authorized: 3000, captured: 3000, movements: ['authorization:succeeded:5400', 'capture:succeeded:3000', 'release:succeeded:2400'] },
  canceled_before_capture: { authorized: 0, captured: 0, movements: ['authorization:succeeded:5400', 'release:succeeded:5400'] },
};

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const doc = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { flow: string; error?: string; events: StripeEvent[] };
  if (doc.error) {
    test(`captured: ${doc.flow} (Stripe refused it in this sandbox)`, { skip: doc.error }, () => {});
    continue;
  }
  test('captured: ' + doc.flow, () => {
    const a = run(doc.events);
    const b = run(tiesReversed(doc.events));
    assert.deepEqual(shape(b), shape(a), 'same result when same-second events arrive the other way round');
    assert.ok(a.receipts.length > 0);
    for (const p of a.payloads) {
      assert.ok(p.totals.captured <= p.totals.authorized);
      assert.ok(p.totals.authorized <= p.totals.mandated && p.totals.refunded <= p.totals.captured);
    }
    const want = expected[doc.flow];
    if (want) {
      assert.equal(a.halted, false);
      assert.equal(a.totals.authorized, want.authorized);
      assert.equal(a.totals.captured, want.captured);
      assert.deepEqual(shape(a).movements, want.movements.slice().sort());
      assert.deepEqual(a.unmapped, []);
    }
    // Refund flows are judged by what Stripe actually sent, since two of them settle later.
    const refunds = doc.events.filter((e) => e.data.object.object === 'refund').map((e) => e.data.object as { status: string; amount: number; destination_details?: { card?: { reference?: string } } });
    if (refunds.length) {
      const failedAfter = refunds.some((r) => r.status === 'succeeded') && refunds.some((r) => r.status === 'failed');
      assert.equal(a.halted, failedAfter);
      if (failedAfter) assert.ok(a.unmapped.some((u) => u.reason === 'refund_failed_after_succeeded'));
      const settled = refunds.some((r) => r.status === 'succeeded');
      assert.equal(a.totals.refunded, settled ? refunds[0].amount : 0);
      const arn = refunds.map((r) => r.destination_details?.card?.reference).find(Boolean);
      const refs = a.payloads.filter((p) => p.event.type === 'refund').map((p) => p.event.network_ref).filter(Boolean);
      assert.deepEqual([...new Set(refs)], arn ? [arn] : []);
    }
  });
}
