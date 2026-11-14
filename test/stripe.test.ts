import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { DisputeBundle } from '../src/aep.ts';
import { verifyChain } from '../src/aep.ts';
import { RenderRefused, STRIPE_TEXT_LIMITS, renderStripeEvidence } from '../src/stripe.ts';
import { looksLikePan, truncate } from '../src/text.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8'));
const schema = fx('stripe/evidence-param.json').evidence_param.properties as Record<string, { type?: string; maxLength?: number }>;
const fileFields = fx('stripe/evidence-param.json').file_fields as string[];

// AEP has not published a signed DisputeBundle yet (vector c is pending), so
// this bundle is built here from vector b plus our own verification result.
function bundle(): { b: DisputeBundle; key: string } {
  const v = fx('aep/b-chain.json');
  const check = verifyChain(v.artifacts, v.ed25519_public_key_base64);
  const b: DisputeBundle = {
    transaction: { id: 'txn_vector_b', transactionType: v.transaction_type, status: 'sealed', interactionChannel: 'text_chat', createdAt: '2026-07-01T12:00:00Z', completedAt: '2026-07-01T12:46:00Z', sealedBundleHash: v.sealed_bundle_hash },
    verification: { valid: true, hashChainIntact: check.hashChainIntact, signaturesValid: check.signaturesValid === true, chainComplete: true, artifactsVerified: check.artifactsVerified, verifiedAt: '2026-07-02T00:00:00Z', verificationMode: 'full', errors: [] },
    artifacts: v.artifacts,
    merchantContext: { merchantId: 'acct_vector_merchant', merchantName: 'Vector Merchant', totalValue: '5500', currency: 'USD' },
    evidenceTier: 'D',
    protocolEnvelopesVerified: [],
    customerHistory: null,
    exportedAt: '2026-07-02T00:00:00Z',
  };
  return { b, key: v.ed25519_public_key_base64 };
}
const RAW = { customer_purchase_ip: '203.0.113.7', customer_email_address: 'buyer@example.com', customer_name: 'Test Buyer', shipping_address: '1 Example St, Springfield, IL 62701, US' };

test('every rendered field is a real Stripe evidence field of the right kind and size', () => {
  const { b, key } = bundle();
  const out = renderStripeEvidence(b, RAW, { publicKeyBase64: key });
  assert.equal(Object.keys(out.evidence).length, 10);
  assert.deepEqual(out.omitted, []);
  assert.deepEqual(out.warnings, []);
  for (const [k, val] of Object.entries(out.evidence)) {
    assert.ok(schema[k], k + ' is not in the Stripe evidence schema');
    assert.equal(schema[k].type, 'string', k + ' must be a text field');
    assert.ok((val as string).length <= (schema[k].maxLength as number), k + ' is over its Stripe limit');
    assert.ok(!looksLikePan(val as string), k);
  }
  for (const k of Object.keys(out.documents)) assert.ok(schema[k] && fileFields.includes(k), k + ' must be a Stripe file field');
  for (const k of Object.keys(out.evidence)) assert.ok(!fileFields.includes(k), k + ' is a file field and must not carry text');
  assert.equal(out.evidence.customer_purchase_ip, '203.0.113.7');
  assert.equal(out.evidence.shipping_carrier, 'UPS');
  assert.equal(out.evidence.shipping_tracking_number, '1Zvector001');
  assert.match(out.evidence.product_description as string, /quantity 1, unit price 45\.99 USD/);
  assert.match(out.evidence.product_description as string, /Order total 55\.00 USD/);
  assert.match(out.evidence.uncategorized_text as string, /Artifacts verified: 8/);
  assert.match(out.evidence.uncategorized_text as string, /\[8\] fulfillment/);
  assert.match(out.documents.receipt, /Amount authorized: 55\.00 USD/);
  assert.match(out.documents.receipt, /Card: visa ending 4242/);
});

test('platform attribution is labeled unverified unless countersigned (AEP 6.5)', () => {
  const { b, key } = bundle();
  const plain = renderStripeEvidence(b, RAW, { publicKeyBase64: key });
  assert.match(plain.evidence.uncategorized_text as string, /not verified by the named platform/);
  assert.match(plain.documents.customer_communication, /not verified by the named platform/);
  const signed = renderStripeEvidence(b, RAW, { publicKeyBase64: key, platformCountersigned: true });
  assert.doesNotMatch(signed.evidence.uncategorized_text as string, /not verified/);
});

test('a hash never stands in for a missing clear text value', () => {
  const { b, key } = bundle();
  const out = renderStripeEvidence(b, {}, { publicKeyBase64: key });
  for (const f of ['customer_purchase_ip', 'customer_email_address', 'customer_name', 'shipping_address']) {
    assert.equal((out.evidence as Record<string, string>)[f], undefined);
    assert.ok(out.omitted.some((o) => o.field === f && /raw plane/.test(o.reason)), f);
  }
});

test('refuses an invalid, cached or tampered bundle (AEP 6.2)', () => {
  const a = bundle();
  a.b.verification.valid = false;
  assert.throws(() => renderStripeEvidence(a.b, RAW), RenderRefused);
  const c = bundle();
  c.b.verification.verificationMode = 'cached';
  assert.throws(() => renderStripeEvidence(c.b, RAW), /cached/);
  const t = bundle();
  (t.b.artifacts[6].hash_input.payload as Record<string, unknown>).amount = 1;
  assert.throws(() => renderStripeEvidence(t.b, RAW, { publicKeyBase64: t.key }), /re-check failed/);
});

test('no public key means a warning, not silence', () => {
  const { b } = bundle();
  const out = renderStripeEvidence(b, RAW);
  assert.ok(out.warnings.some((w) => /signatures not re-checked/.test(w)));
});

test('missing fulfillment gives a placeholder page and named omissions', () => {
  const { b } = bundle();
  b.artifacts = b.artifacts.slice(0, 7);
  b.verification.artifactsVerified = 7;
  const out = renderStripeEvidence(b, RAW);
  assert.match(out.documents.shipping_documentation, /No fulfillment artifact recorded/);
  assert.equal(out.omitted.filter((o) => /no fulfillment artifact/.test(o.reason)).length, 3);
});

test('refuses when a card number would leave in evidence (AEP 8.3)', () => {
  const { b, key } = bundle();
  assert.throws(() => renderStripeEvidence(b, { ...RAW, customer_name: 'Card 4242 4242 4242 4242' }, { publicKeyBase64: key }), /card number/);
  assert.equal(looksLikePan('order 1234567890123'), false);
  assert.equal(looksLikePan('sha256:da28c3c1e9accdacde37f379de309e44b244585c6bf14faa74d246c42fdba17'), false);
});

test('truncate never cuts a word or a hash in half', () => {
  const text = 'alpha beta sha256:ffef0d2f26e1a87ce87f89031c3bb982 gamma';
  const cut = truncate(text, 40);
  assert.equal(cut.truncated, true);
  assert.ok(cut.text.length <= 40);
  assert.equal(cut.text, 'alpha beta [truncated]');
  assert.deepEqual(truncate('short', 40), { text: 'short', truncated: false });
});

test('our text limits are the Stripe write limits, field by field', () => {
  for (const [k, n] of Object.entries(STRIPE_TEXT_LIMITS)) assert.equal(schema[k].maxLength, n, k);
});

test('a long field is cut to the Stripe write limit on a word boundary', () => {
  const { b } = bundle();
  const cart = b.artifacts[5].hash_input.payload as { items: Array<Record<string, unknown>> };
  const one = cart.items[0];
  cart.items = Array.from({ length: 900 }, () => ({ ...one }));
  const out = renderStripeEvidence(b, RAW, { reverify: false });
  const d = out.evidence.product_description as string;
  assert.ok(d.length <= 20000);
  assert.ok(d.endsWith('[truncated]'));
  assert.ok(out.warnings.some((w) => /product_description was cut/.test(w)));
});

test('card numbers are caught next to other digits, with odd separators, and glued to letters', () => {
  for (const s of [
    '4242 4242 4242 4242 12/29 123', '12 4242 4242 4242 4242 99', '4242.4242.4242.4242', '4242/4242/4242/4242',
    '4242  4242  4242  4242', '4242\n4242\n4242\n4242', '4242\t4242\t4242\t4242', '4242\u00a04242\u00a04242\u00a04242',
    '4242 - 4242 - 4242 - 4242', 'card4242424242424242', '4242424242424242USD', '4242-4242-4242-4242', '99994242424242424242999',
  ]) assert.equal(looksLikePan(s), true, JSON.stringify(s));
  for (const s of [
    '2026-07-01 2026-07-02 12:46', '203.0.113.7 198.51.100.24', 'Order total 55.00 USD, 2 items, ref 100200',
    'sha256:da28c3c1e9accdacde37f379de309e44b244585c6bf14faa74d246c42fdba17', '1Zvector001', 'call 512 555 0100 or 512 555 0199',
  ]) assert.equal(looksLikePan(s), false, JSON.stringify(s));
});

test('a short or card shaped tracking number cannot hide a card number', () => {
  const { b, key } = bundle();
  const f = b.artifacts.find((a) => (a.hash_input.payload as Record<string, unknown>).tracking_number !== undefined)!;
  const p = f.hash_input.payload as Record<string, unknown>;
  p.tracking_number = '42';
  assert.throws(() => renderStripeEvidence(b, { ...RAW, customer_name: 'Card 4242 4242 4242 4242' }, { reverify: false }), /card number/);
  p.tracking_number = '4242424242424242';
  assert.throws(() => renderStripeEvidence(b, RAW, { reverify: false }), /shipping_tracking_number looks like/);
  p.tracking_number = '9400111899223197428490';
  assert.doesNotThrow(() => renderStripeEvidence(b, RAW, { reverify: false }));
  void key;
});

test('card numbers split by commas, underscores, colons, wide gaps, odd hyphens or hidden characters are caught', () => {
  for (const s of [
    'Card 4242,4242,4242,4242', 'Card 4242_4242_4242_4242', '4242:4242:4242:4242', '4242     4242     4242     4242',
    '\uff14\uff12\uff14\uff12\uff14\uff12\uff14\uff12\uff14\uff12\uff14\uff12\uff14\uff12\uff14\uff12',
    '4242\u20114242\u20114242\u20114242', '4242\u200b4242\u200b4242\u200b4242', '4242, 4242, 4242, 4242',
  ]) assert.equal(looksLikePan(s), true, JSON.stringify(s));
  for (const s of [
    'Total 1,234.56 USD, 2 items', 'shipped 2026_11_14 at 10:50:12', 'ref 1234, 5678, 9012',
  ]) assert.equal(looksLikePan(s), false, JSON.stringify(s));
});

test('a tracking value that sits inside a card number does not hide it', () => {
  const { b } = bundle();
  const f = b.artifacts.find((a) => (a.hash_input.payload as Record<string, unknown>).tracking_number !== undefined)!;
  const p = f.hash_input.payload as Record<string, unknown>;
  p.tracking_number = '42424242';
  assert.throws(() => renderStripeEvidence(b, { ...RAW, customer_name: '4242424242424242' }, { reverify: false }), /customer_name looks like/);
  p.tracking_number = '4242 4242';
  assert.throws(() => renderStripeEvidence(b, { ...RAW, customer_name: '4242 4242 4242 4242' }, { reverify: false }), /customer_name looks like/);
  p.tracking_number = '9400111899223197428490';
  assert.doesNotThrow(() => renderStripeEvidence(b, { ...RAW, customer_name: 'Pat Doe' }, { reverify: false }));
});

test('refuses an empty bundle, a count mismatch and a verification block that contradicts itself', () => {
  const { b, key } = bundle();
  assert.throws(() => renderStripeEvidence({ ...b, artifacts: [] }, RAW, { publicKeyBase64: key }), /no artifacts/);
  assert.throws(() => renderStripeEvidence({ ...b, artifacts: b.artifacts.slice(0, 5) }, RAW, { publicKeyBase64: key }), /artifacts were verified but holds/);
  assert.throws(() => renderStripeEvidence({ ...b, verification: { ...b.verification, hashChainIntact: false } }, RAW, { publicKeyBase64: key }), /contradicts itself/);
});

test('a long value with no whitespace is cut hard, not dropped', () => {
  const cut = truncate('x'.repeat(100), 40);
  assert.equal(cut.truncated, true);
  assert.equal(cut.text.length, 40);
  assert.ok(cut.text.startsWith('xxxx'));
});
