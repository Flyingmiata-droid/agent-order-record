import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { RECEIPT_TYP, sha256Ref, stripeToReceipts } from '../src/ucp-receipts.ts';
import type { ReceiptContext, ReceiptPayload } from '../src/ucp-receipts.ts';
import { scenarios } from './fixtures/stripe-events/scenarios.ts';

// A fresh test key each run. No private key lives in the repo.
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const ctxFor = (name: string, mandated: number, overcapture?: 'hold' | 'adjust'): ReceiptContext => ({
  iss: 'https://merchant.example/.well-known/ucp',
  order_id: 'order_' + name,
  checkout_id: 'chk_' + name,
  mandateToken: 'test_only_payment_mandate_' + name,
  mandated,
  privateJwk: privateKey.export({ format: 'jwk' }),
  kid: 'test_only_adapter',
  overcapture,
});
const pub = createPublicKey(publicKey.export({ format: 'pem', type: 'spki' }));
const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

for (const s of scenarios) {
  test('ucp receipts: ' + s.name, () => {
    const chain = stripeToReceipts(s.events, ctxFor(s.name, s.mandated, s.overcapture));
    assert.deepEqual(chain.payloads.map((p) => `${p.event.type}:${p.event.status}:${p.event.amount}`), s.expect);
    assert.deepEqual(chain.unmapped.map((u) => u.reason), s.expectUnmapped);
    assert.deepEqual({ authorized: chain.totals.authorized, captured: chain.totals.captured, refunded: chain.totals.refunded }, s.expectTotals);

    // Every receipt verifies from its own bytes, chains to the one before, and
    // states totals that a reader recomputes from the succeeded events it holds.
    const t = { authorized: 0, captured: 0, refunded: 0 };
    const counted = new Set<string>();
    let prev: string | null = null;
    chain.receipts.forEach((jws, i) => {
      const [h, p, sig] = jws.split('.');
      assert.deepEqual(decode(h), { alg: 'ES256', kid: 'test_only_adapter', typ: RECEIPT_TYP });
      assert.ok(verify('sha256', Buffer.from(h + '.' + p, 'ascii'), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'signature');
      const payload = decode(p) as ReceiptPayload;
      assert.deepEqual(payload, chain.payloads[i]);
      assert.equal(payload.seq, i + 1);
      assert.equal(payload.prev, prev);
      assert.equal(payload.mandate_ref, sha256Ref('test_only_payment_mandate_' + s.name));
      prev = sha256Ref(jws);
      const e = payload.event;
      const k = e.type + '|' + (e.ref?.processing_entry_id ?? '');
      if (e.status === 'succeeded' && !counted.has(k)) {
        counted.add(k);
        if (e.type === 'authorization' || e.type === 'authorization_adjustment') t.authorized += e.amount;
        if (e.type === 'release') t.authorized -= e.amount;
        if (e.type === 'capture') t.captured += e.amount;
        if (e.type === 'refund') t.refunded += e.amount;
      }
      assert.deepEqual(payload.totals, { mandated: s.mandated, ...t });
      assert.ok(t.captured <= t.authorized && t.authorized <= s.mandated && t.refunded <= t.captured, 'spec invariants');
      // Business Requirements 10: no card numbers, tokens or buyer data.
      assert.ok(!/test_only_payment_mandate|\b\d{13,19}\b(?!\d)/.test(JSON.stringify({ ...payload, event: { ...e, network_ref: undefined } })));
    });
  });
}

test('ucp receipts: late ARN follow-up reuses the entry id and leaves totals alone', () => {
  const s = scenarios.find((x) => x.name === 'refund_succeeds_then_late_arn')!;
  const { payloads } = stripeToReceipts(s.events, ctxFor(s.name, s.mandated));
  const [first, second] = payloads.filter((p) => p.event.type === 'refund');
  assert.equal(first.event.network_ref, undefined);
  assert.equal(second.event.network_ref, '74000000000000000001063');
  assert.equal(second.event.ref?.processing_entry_id, first.event.ref?.processing_entry_id);
  assert.deepEqual(second.totals, first.totals);
});

test('ucp receipts: a reversal never gets a network_ref', () => {
  const s = scenarios.find((x) => x.name === 'refund_settles_as_reversal_no_arn')!;
  const { payloads } = stripeToReceipts(s.events, ctxFor(s.name, s.mandated));
  assert.ok(payloads.every((p) => p.event.network_ref === undefined));
});

test('ucp receipts: same events twice sign nothing new', () => {
  const s = scenarios.find((x) => x.name === 'multicapture_two_shipments')!;
  const once = stripeToReceipts(s.events, ctxFor(s.name, s.mandated));
  const twice = stripeToReceipts([...s.events, ...s.events], ctxFor(s.name, s.mandated));
  assert.equal(twice.receipts.length, once.receipts.length);
});
