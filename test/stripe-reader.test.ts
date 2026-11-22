import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { readStripePaymentIntent, STRIPE_READER_SOURCES, StripeReadRefused } from '../src/stripe-reader.ts';
import { handle, TOOLS } from '../src/mcp.ts';
import { loadScorecard } from '../src/tools.ts';

const path = (name: string) => new URL('./fixtures/stripe-intents/' + name, import.meta.url).pathname;
const fx = (name: string) => JSON.parse(readFileSync(path(name), 'utf8'));
const bin = new URL('../bin/aor.ts', import.meta.url).pathname;

test('stripe reader: a PaymentIntent with agent_details reads as marker present', () => {
  const r = readStripePaymentIntent(fx('agent-payment-intent.json'));
  assert.equal(r.marker, 'present');
  assert.equal(r.read_from, 'payment_intent');
  assert.equal(r.payment_intent_id, 'pi_made_up_agent_0001');
  assert.deepEqual(r.agent, { name: 'Example Agent', network_business_profile: 'profile_made_up_0001' });
  assert.deepEqual(r.intent, { status: 'succeeded', amount: 12900, currency: 'usd', created: '2026-11-20T18:40:00.000Z', latest_charge: 'ch_made_up_0001', livemode: false });
  assert.ok(r.keep.includes('agent_details.name'));
  assert.ok(r.warnings.some((w) => w.includes('private preview')));
  assert.ok(r.warnings.some((w) => w.includes('Dispute object has no agent field')));
});

test('stripe reader: null and missing agent_details read as absent, and say why that proves nothing', () => {
  const nul = readStripePaymentIntent(fx('plain-payment-intent.json'));
  assert.equal(nul.marker, 'absent');
  assert.equal(nul.agent, null);
  assert.ok(nul.warnings[0].startsWith('agent_details is null.'));
  const tx = fx('plain-payment-intent.json');
  delete tx.agent_details;
  const missing = readStripePaymentIntent(tx);
  assert.equal(missing.marker, 'absent');
  assert.ok(missing.warnings[0].startsWith('No agent_details key'));
  for (const r of [nul, missing]) assert.ok(r.warnings[0].includes('does not prove a person placed the order'));
});

test('stripe reader: reads through a Checkout Session and a webhook event', () => {
  const pi = fx('agent-payment-intent.json');
  const direct = readStripePaymentIntent(pi);
  const session = readStripePaymentIntent({ id: 'cs_made_up', object: 'checkout.session', payment_intent: pi });
  assert.equal(session.read_from, 'checkout_session');
  assert.deepEqual({ ...session, read_from: 'payment_intent' }, direct);
  const event = readStripePaymentIntent({ id: 'evt_made_up', object: 'event', type: 'checkout.session.completed', data: { object: { id: 'cs_made_up', object: 'checkout.session', payment_intent: pi } } });
  assert.equal(event.read_from, 'event');
  assert.equal(event.marker, 'present');
});

test('stripe reader: a session with payment_intent as an id says expand it, not absent', () => {
  const r = readStripePaymentIntent({ id: 'cs_made_up', object: 'checkout.session', payment_intent: 'pi_made_up_agent_0001' });
  assert.equal(r.marker, 'not_expanded');
  assert.equal(r.payment_intent_id, 'pi_made_up_agent_0001');
  assert.ok(r.warnings[0].includes('expand[]=payment_intent'));
});

test('stripe reader: expanded profile and charge are reduced to their ids', () => {
  const pi = fx('agent-payment-intent.json');
  pi.agent_details.network_business_profile = { id: 'profile_made_up_0001', object: 'profile', display_name: 'not copied' };
  pi.latest_charge = { id: 'ch_made_up_0001', object: 'charge', payment_method_details: { card: { last4: '4242' } } };
  const r = readStripePaymentIntent(pi);
  assert.equal(r.agent!.network_business_profile, 'profile_made_up_0001');
  assert.equal(r.intent.latest_charge, 'ch_made_up_0001');
  assert.ok(!JSON.stringify(r).includes('not copied') && !JSON.stringify(r).includes('4242'));
});

test('stripe reader: refuses junk, the wrong object, a non object marker and a card number', () => {
  assert.throws(() => readStripePaymentIntent(null), StripeReadRefused);
  assert.throws(() => readStripePaymentIntent({ id: 'ch_1', object: 'charge' }), /expected object "payment_intent"/);
  assert.throws(() => readStripePaymentIntent({ object: 'event', data: {} }), /no data\.object/);
  assert.throws(() => readStripePaymentIntent({ id: 'pi_1', object: 'payment_intent', agent_details: 'Example Agent' }), /not an object/);
  const pi = fx('agent-payment-intent.json');
  pi.agent_details.name = 'card 4111 1111 1111 1111';
  assert.throws(() => readStripePaymentIntent(pi), /looks like a full card number/);
  const empty = fx('plain-payment-intent.json');
  empty.agent_details = {};
  assert.equal(readStripePaymentIntent(empty).marker, 'empty');
});

test('stripe reader: agrees with the scorecard row it rests on', () => {
  const row = loadScorecard().gateways.find((g) => g.id === 'stripe')!;
  assert.equal(row.cells.api_field.code, 'YES');
  assert.ok(row.cells.api_field.detail!.includes('agent_details.name and agent_details.network_business_profile'));
  // The dispute warning is only true while this cell is not YES.
  assert.notEqual(row.cells.disputes.code, 'YES');
  const cited = new Set(Object.values(row.cells).flatMap((c) => c.sources.map((s) => s.url)));
  for (const url of STRIPE_READER_SOURCES) assert.ok(cited.has(url), url);
});

test('stripe reader: the MCP tool and the command line give the same read', () => {
  assert.ok(TOOLS.some((t) => t.name === 'read_stripe_payment_intent'));
  const r = handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_stripe_payment_intent', arguments: { object: fx('agent-payment-intent.json') } } }) as any;
  assert.equal(r.result.isError, false);
  const viaMcp = JSON.parse(r.result.content[0].text);
  const viaCli = JSON.parse(execFileSync(process.execPath, [bin, 'stripe-intent', path('agent-payment-intent.json')], { encoding: 'utf8' }));
  assert.deepEqual(viaCli, viaMcp);
  assert.equal(spawnSync(process.execPath, [bin, 'stripe-intent', path('plain-payment-intent.json')], { encoding: 'utf8' }).status, 1);
  const bad = handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_stripe_payment_intent', arguments: { object: { object: 'charge' } } } }) as any;
  assert.equal(bad.result.isError, true);
});
