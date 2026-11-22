import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { ADYEN_SOURCES, readAdyenObject } from '../src/adyen.ts';
import { ReadRefused } from '../src/braintree.ts';
import { handle, TOOLS } from '../src/mcp.ts';
import { loadScorecard } from '../src/tools.ts';

const path = (name: string) => new URL('./fixtures/adyen/' + name, import.meta.url).pathname;
const fx = (name: string) => JSON.parse(readFileSync(path(name), 'utf8'));
const bin = new URL('../bin/aor.ts', import.meta.url).pathname;

test('adyen: an AUTHORISATION webhook reads as marker present, said by Adyen', () => {
  const r = readAdyenObject(fx('authorisation-webhook.json'));
  assert.equal(r.source, 'webhook');
  assert.equal(r.said_by, 'adyen');
  assert.equal(r.marker, 'present');
  assert.deepEqual(r.agent, { platform: 'openai', session_id: 'sess_example_7f3a', protocol: null });
  assert.deepEqual(r.matched_keys, ['additionalData.shoppingPlatform', 'additionalData.sessionId']);
  assert.equal(r.order.psp_reference, 'QFQTPCQ8HXSKGK82');
  assert.equal(r.order.amount_value, '12900');
  assert.ok(r.keep.includes('pspReference'));
  assert.ok(r.warnings.some((w) => w.includes('prints no example webhook')));
  assert.ok(r.warnings.some((w) => w.includes('silent on any agent field for disputes')));
});

test('adyen: one bare item, the agentic. prefix and a nested agentic object all read the same', () => {
  const flat = readAdyenObject(fx('authorisation-webhook.json'));
  const item = fx('authorisation-webhook.json').notificationItems[0].NotificationRequestItem;
  assert.deepEqual(readAdyenObject(item), flat);
  const dotted = structuredClone(item);
  dotted.additionalData = { 'agentic.sessionId': 'sess_example_7f3a', 'agentic.shoppingPlatform': 'openai' };
  const d = readAdyenObject(dotted);
  assert.deepEqual(d.agent, flat.agent);
  assert.deepEqual(d.matched_keys, ['additionalData.agentic.shoppingPlatform', 'additionalData.agentic.sessionId']);
  const nested = structuredClone(item);
  nested.additionalData = { agentic: { sessionId: 'sess_example_7f3a', shoppingPlatform: 'openai' } };
  assert.deepEqual(readAdyenObject(nested).agent, flat.agent);
});

test('adyen: a chargeback webhook reads as absent and points at the saved authorisation', () => {
  const r = readAdyenObject(fx('chargeback-webhook.json'));
  assert.equal(r.marker, 'absent');
  assert.equal(r.order.event_code, 'NOTIFICATION_OF_CHARGEBACK');
  assert.equal(r.order.original_reference, 'QFQTPCQ8HXSKGK82');
  assert.equal(r.order.original_reference, readAdyenObject(fx('authorisation-webhook.json')).order.psp_reference);
  assert.deepEqual(r.keep, []);
  assert.ok(r.warnings.some((w) => w.includes('Match originalReference')));
});

test('adyen: a plain authorisation with no agent keys does not claim a person ordered', () => {
  const w = fx('authorisation-webhook.json');
  w.notificationItems[0].NotificationRequestItem.additionalData = { cardSummary: '1111' };
  const r = readAdyenObject(w);
  assert.equal(r.marker, 'absent');
  assert.ok(r.warnings.some((x) => x.includes('does not prove a person placed the order')));
});

test('adyen: a cart session request names the platform and says where the session id is', () => {
  const r = readAdyenObject(fx('cart-session-request.json'));
  assert.equal(r.source, 'cart_session_request');
  assert.equal(r.said_by, 'adyen');
  assert.equal(r.marker, 'present');
  assert.equal(r.agent.platform, 'openai');
  assert.equal(r.agent.session_id, null);
  assert.equal(r.order.currency, 'USD');
  assert.ok(r.warnings.some((w) => w.includes('/agentic/sessions/{sessionId}')));
  const none = fx('cart-session-request.json');
  delete none.shoppingPlatform;
  const n = readAdyenObject(none);
  assert.equal(n.marker, 'absent');
  assert.ok(n.warnings.some((w) => w.includes('lists it as required')));
});

test('adyen: metadata on a /payments request is the merchant speaking, not Adyen', () => {
  const r = readAdyenObject(fx('payments-request-ucp.json'));
  assert.equal(r.source, 'payments_request');
  assert.equal(r.said_by, 'merchant');
  assert.equal(r.marker, 'present');
  assert.deepEqual(r.agent, { platform: 'Google', session_id: 'ucp_session_example_19c', protocol: 'UCP' });
  assert.ok(r.warnings.some((w) => w.includes('ones you wrote on your own request')));
  const bare = fx('payments-request-ucp.json');
  delete bare.metadata;
  const b = readAdyenObject(bare);
  assert.equal(b.marker, 'absent');
  assert.equal(b.said_by, 'merchant');
});

test('adyen: a session id with no platform is present but flagged', () => {
  const w = fx('authorisation-webhook.json');
  delete w.notificationItems[0].NotificationRequestItem.additionalData.shoppingPlatform;
  const r = readAdyenObject(w);
  assert.equal(r.marker, 'present');
  assert.ok(r.warnings.some((x) => x.includes('does not say which agent')));
});

test('adyen: a failed authorisation and a batch of items each get a warning', () => {
  const w = fx('authorisation-webhook.json');
  w.notificationItems[0].NotificationRequestItem.success = 'false';
  w.notificationItems.push(structuredClone(w.notificationItems[0]));
  const r = readAdyenObject(w);
  assert.ok(r.warnings.some((x) => x.includes('did not go through')));
  assert.ok(r.warnings.some((x) => x.includes('holds 2 items')));
});

test('adyen: other additionalData never leaves, and a card number in a field is refused', () => {
  const w = fx('authorisation-webhook.json');
  w.notificationItems[0].NotificationRequestItem.additionalData.cardHolderName = 'Pat Example';
  const out = JSON.stringify(readAdyenObject(w));
  assert.ok(!out.includes('Pat Example') && !out.includes('cardSummary'));
  w.notificationItems[0].NotificationRequestItem.merchantReference = '4111 1111 1111 1111';
  assert.throws(() => readAdyenObject(w), /looks like a full card number/);
  const s = fx('authorisation-webhook.json');
  s.notificationItems[0].NotificationRequestItem.additionalData.shoppingPlatform = '4111111111111111';
  assert.throws(() => readAdyenObject(s), /looks like a full card number/);
});

test('adyen: refuses junk and wrong shapes', () => {
  assert.throws(() => readAdyenObject('x'), ReadRefused);
  assert.throws(() => readAdyenObject({ foo: 1 }), /does not look like an Adyen/);
  assert.throws(() => readAdyenObject({ notificationItems: [] }), /empty/);
  assert.throws(() => readAdyenObject({ eventCode: 'AUTHORISATION', additionalData: 'openai' }), /additionalData is not an object/);
  assert.throws(() => readAdyenObject({ merchantAccount: 'X', metadata: 'UCP' }), /metadata is not an object/);
});

test('adyen: the reader agrees with the scorecard row it rests on', () => {
  const row = loadScorecard().gateways.find((g) => g.id === 'adyen')!;
  assert.ok(row.cells.api_field.detail!.includes('shoppingPlatform'));
  assert.ok(row.cells.api_field.detail!.includes('metadata.agentProtocol'));
  assert.ok(row.cells.reporting.detail!.includes('AUTHORISATION webhook carries sessionId and shoppingPlatform'));
  // The dispute warnings are only true while this cell is not YES.
  assert.notEqual(row.cells.disputes.code, 'YES');
  const cited = new Set(Object.values(row.cells).flatMap((c) => c.sources.map((s) => s.url)));
  assert.ok(cited.has(ADYEN_SOURCES[0]) && cited.has(ADYEN_SOURCES[1]));
});

test('adyen: the MCP tool and the command line give the same read', () => {
  assert.ok(TOOLS.some((t) => t.name === 'read_adyen_object'));
  const r = handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_adyen_object', arguments: { object: fx('authorisation-webhook.json') } } }) as any;
  assert.equal(r.result.isError, false);
  const viaMcp = JSON.parse(r.result.content[0].text);
  assert.equal(viaMcp.marker, 'present');
  const viaCli = JSON.parse(execFileSync(process.execPath, [bin, 'adyen', path('authorisation-webhook.json')], { encoding: 'utf8' }));
  assert.deepEqual(viaCli, viaMcp);
  assert.equal(spawnSync(process.execPath, [bin, 'adyen', path('chargeback-webhook.json')], { encoding: 'utf8' }).status, 1);
  const bad = handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_adyen_object', arguments: { object: 'x' } } }) as any;
  assert.equal(bad.result.isError, true);
});
