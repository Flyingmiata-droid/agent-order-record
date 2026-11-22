import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { BRAINTREE_SOURCES, ReadRefused, readBraintreeTransaction } from '../src/braintree.ts';
import { handle, TOOLS } from '../src/mcp.ts';
import { loadScorecard } from '../src/tools.ts';
import { fileURLToPath } from 'node:url';

const fx = (name: string) => JSON.parse(readFileSync(new URL('./fixtures/braintree/' + name, import.meta.url), 'utf8'));
const bin = fileURLToPath(new URL('../bin/aor.ts', import.meta.url));

test('braintree: an ACP transaction reads as marker present with the application named', () => {
  const r = readBraintreeTransaction(fx('acp-transaction.json'));
  assert.equal(r.marker, 'present');
  assert.equal(r.transaction_id, 'bt9x4k2m');
  assert.deepEqual(r.facilitator, { oauth_application_name: 'ChatGPT', oauth_application_client_id: 'oauth_client_abc123', has_source_payment_method_token: false });
  assert.equal(r.order.amount, '129.00');
  assert.equal(r.order.currency_iso_code, 'USD');
  assert.ok(r.keep.includes('facilitator_details.oauth_application_name'));
  assert.ok(r.warnings.some((w) => w.includes('not only AI agents')));
  assert.ok(r.warnings.some((w) => w.includes('Dispute object has no facilitator field')));
});

test('braintree: no facilitator_details reads as absent and does not claim a person ordered', () => {
  const r = readBraintreeTransaction(fx('plain-transaction.json'));
  assert.equal(r.marker, 'absent');
  assert.equal(r.facilitator, null);
  assert.deepEqual(r.keep, []);
  assert.ok(r.warnings.some((w) => w.includes('does not prove a person placed the order')));
});

test('braintree: camelCase keys and a result wrapper read the same as snake_case', () => {
  const snake = readBraintreeTransaction(fx('acp-transaction.json'));
  const camel = readBraintreeTransaction({
    success: true,
    transaction: {
      id: 'bt9x4k2m', status: 'submitted_for_settlement', amount: '129.00', currencyIsoCode: 'USD', merchantAccountId: 'example_usd',
      orderId: 'order-10441', createdAt: '2026-11-20T15:04:05Z', paymentInstrumentType: 'credit_card', networkTransactionId: '020260112345678',
      facilitatorDetails: { oauthApplicationClientId: 'oauth_client_abc123', oauthApplicationName: 'ChatGPT' },
    },
  });
  assert.deepEqual(camel, snake);
});

test('braintree: the vault token is reported as held, never copied out', () => {
  const tx = fx('acp-transaction.json');
  tx.facilitator_details.source_payment_method_token = 'tok_facilitator_vault_1';
  const r = readBraintreeTransaction(tx);
  assert.equal(r.facilitator!.has_source_payment_method_token, true);
  assert.ok(!JSON.stringify(r).includes('tok_facilitator_vault_1'));
});

test('braintree: an empty facilitator_details is its own state', () => {
  const tx = fx('plain-transaction.json');
  tx.facilitator_details = { oauth_application_name: '  ' };
  assert.equal(readBraintreeTransaction(tx).marker, 'empty');
});

test('braintree: refuses junk, a non object marker, and a card number in a field', () => {
  assert.throws(() => readBraintreeTransaction('x'), ReadRefused);
  assert.throws(() => readBraintreeTransaction({ foo: 1 }), /does not look like a Braintree transaction/);
  assert.throws(() => readBraintreeTransaction({ id: 'a1', facilitator_details: 'ChatGPT' }), /not an object/);
  const tx = fx('acp-transaction.json');
  tx.order_id = '4111 1111 1111 1111';
  assert.throws(() => readBraintreeTransaction(tx), /looks like a full card number/);
});

test('braintree: the reader agrees with the scorecard row it rests on', () => {
  const row = loadScorecard().gateways.find((g) => g.id === 'braintree')!;
  assert.equal(row.cells.api_field.code, 'YES');
  assert.ok(row.cells.api_field.detail!.includes('facilitator_details.oauth_application_name'));
  // The dispute warning is only true while this cell is not YES.
  assert.notEqual(row.cells.disputes.code, 'YES');
  const cited = new Set(Object.values(row.cells).flatMap((c) => c.sources.map((s) => s.url)));
  assert.ok(cited.has(BRAINTREE_SOURCES[0]) && cited.has(BRAINTREE_SOURCES[2]));
});

test('braintree: the MCP tool and the command line give the same read', () => {
  assert.ok(TOOLS.some((t) => t.name === 'read_braintree_transaction'));
  const r = handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_braintree_transaction', arguments: { transaction: fx('acp-transaction.json') } } }) as any;
  assert.equal(r.result.isError, false);
  const viaMcp = JSON.parse(r.result.content[0].text);
  assert.equal(viaMcp.marker, 'present');
  const viaCli = JSON.parse(execFileSync(process.execPath, [bin, 'braintree', fileURLToPath(new URL('./fixtures/braintree/acp-transaction.json', import.meta.url))], { encoding: 'utf8' }));
  assert.deepEqual(viaCli, viaMcp);
  const plain = spawnSync(process.execPath, [bin, 'braintree', fileURLToPath(new URL('./fixtures/braintree/plain-transaction.json', import.meta.url))], { encoding: 'utf8' });
  assert.equal(plain.status, 1);
  const bad = handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'read_braintree_transaction', arguments: { transaction: 'x' } } }) as any;
  assert.equal(bad.result.isError, true);
});
