import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PROTOCOL_VERSIONS, TOOLS, handle } from '../src/mcp.ts';
import { COLUMNS } from '../src/scorecard.ts';
import { loadScorecard } from '../src/tools.ts';

const bin = fileURLToPath(new URL('../bin/aor.ts', import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/' + n, import.meta.url), 'utf8'));
const call = (name: string, args: unknown, id = 1) => handle({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) as any;
const body = (r: any) => JSON.parse(r.result.content[0].text);

test('mcp: initialize echoes a known version and falls back to the newest', () => {
  const a = handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } } }) as any;
  assert.equal(a.result.protocolVersion, '2025-03-26');
  assert.deepEqual(a.result.capabilities, { tools: { listChanged: false } });
  assert.equal(a.result.serverInfo.name, 'agent-order-record');
  const b = handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }) as any;
  assert.equal(b.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('mcp: notifications get no reply, unknown methods get -32601, junk gets -32600', () => {
  assert.equal(handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assert.equal(handle({ jsonrpc: '2.0', method: 'no/such/note' }), null);
  assert.equal((handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' }) as any).error.code, -32601);
  assert.equal((handle([1, 2]) as any).error.code, -32600);
  assert.equal((handle({ id: 4, method: 'ping' }) as any).error.code, -32600);
  assert.deepEqual((handle({ jsonrpc: '2.0', id: 'p', method: 'ping' }) as any).result, {});
});

test('mcp: tools/list names every tool with an object schema and read only hints', () => {
  const r = handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as any;
  assert.equal(r.result.tools.length, TOOLS.length);
  for (const t of r.result.tools) {
    assert.match(t.name, /^[a-z0-9_]+$/);
    assert.equal(t.inputSchema.type, 'object');
    assert.equal(t.annotations.readOnlyHint, true);
    assert.ok(t.description.length > 40);
  }
});

test('mcp: scorecard tools answer from data/scorecard.json', () => {
  const card = loadScorecard();
  const list = body(call('list_gateways', {}));
  assert.equal(list.gateways.length, card.gateways.length);
  assert.deepEqual(Object.keys(list.gateways[0].codes), [...COLUMNS]);
  const one = body(call('get_gateway', { gateway: 'Stripe', column: 'disputes' }));
  assert.equal(one.id, 'stripe');
  assert.deepEqual(Object.keys(one.cells), ['disputes']);
  assert.equal(one.cells.disputes.code, card.gateways.find((g) => g.id === 'stripe')!.cells.disputes.code);
  assert.ok(one.cells.disputes.sources.length > 0);
  const found = body(call('find_gateways', { column: 'api_field', code: 'yes' }));
  assert.equal(found.count, card.gateways.filter((g) => g.cells.api_field.code === 'YES').length);
  assert.ok(found.gateways.some((g: { id: string }) => g.id === 'stripe'));
});

test('mcp: bad arguments come back as a tool error, an unknown tool as -32602', () => {
  const r = call('get_gateway', { gateway: 'nope' });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /Known ids: stripe/);
  assert.equal(call('find_gateways', { column: 'disputes', code: 'MAYBE' }).result.isError, true);
  assert.equal(call('verify_aep_chain', { artifacts: [] }).result.isError, true);
  assert.equal(call('verify_aep_chain', { artifacts: [{}] }).result.isError, true);
  assert.equal(call('render_stripe_evidence', { bundle: {} }).result.isError, true);
  assert.equal(call('check_ce3', { input: { network: 'visa' } }).result.isError, true);
  assert.equal(call('no_such_tool', {}).error.code, -32602);
  assert.equal(call('list_gateways', [1]).error.code, -32602);
});

test('mcp: verify_aep_chain passes vector b and catches one changed byte', () => {
  const v = fx('aep/b-chain.json');
  const good = body(call('verify_aep_chain', { artifacts: v.artifacts, public_key_base64: v.ed25519_public_key_base64 }));
  assert.equal(good.hashChainIntact, true);
  assert.equal(good.signatures, 'valid');
  assert.equal(good.artifactsVerified, v.artifacts.length);
  assert.equal(body(call('verify_aep_chain', { artifacts: v.artifacts })).signatures, 'not checked: no public key given');
  const bad = structuredClone(v.artifacts);
  bad[1].hash_input.timestamp = bad[1].hash_input.timestamp + ' ';
  const r = body(call('verify_aep_chain', { artifacts: bad, public_key_base64: v.ed25519_public_key_base64 }));
  assert.equal(r.hashChainIntact, false);
  assert.ok(r.errors.length > 0);
});

function bundle() {
  const v = fx('aep/b-chain.json');
  return {
    key: v.ed25519_public_key_base64 as string,
    b: {
      transaction: { id: 'txn_vector_b', transactionType: v.transaction_type, status: 'sealed', interactionChannel: 'text_chat', createdAt: '2026-07-01T12:00:00Z', completedAt: '2026-07-01T12:46:00Z', sealedBundleHash: v.sealed_bundle_hash },
      verification: { valid: true, hashChainIntact: true, signaturesValid: true, chainComplete: true, artifactsVerified: v.artifacts.length, verifiedAt: '2026-07-02T00:00:00Z', verificationMode: 'full', errors: [] },
      artifacts: v.artifacts,
      merchantContext: { merchantId: 'acct_vector_merchant', merchantName: 'Vector Merchant', totalValue: '5500', currency: 'USD' },
      evidenceTier: 'D', protocolEnvelopesVerified: [], customerHistory: null, exportedAt: '2026-07-02T00:00:00Z',
    },
  };
}

test('mcp: render_stripe_evidence renders a good bundle and refuses a failed one', () => {
  const { b, key } = bundle();
  const good = call('render_stripe_evidence', { bundle: b, public_key_base64: key, raw: { customer_name: 'Test Buyer' } });
  assert.equal(good.result.isError, false);
  const out = body(good);
  assert.equal(out.refused, false);
  assert.equal(out.evidence.customer_name, 'Test Buyer');
  assert.ok(out.evidence.product_description.length > 0);
  const failed = structuredClone(b);
  failed.verification.valid = false;
  const r = call('render_stripe_evidence', { bundle: failed, public_key_base64: key });
  assert.equal(r.result.isError, true);
  assert.equal(body(r).refused, true);
  assert.match(body(r).reason, /render refused/);
});

test('mcp: check_ce3 answers with reasons', () => {
  const tx = { customer_purchase_ip: '203.0.113.7', device_ip_owner: 'customer', customer_device_id: 'dev_1', shipping_address: '1 Example St' };
  const input = {
    network: 'visa', reason_code: '10.4', dispute_date: '2026-11-01',
    disputed: { date: '2026-10-01', ...tx },
    priors: [{ date: '2026-05-01', ...tx }, { date: '2026-03-01', ...tx }],
  };
  const yes = body(call('check_ce3', { input }));
  assert.equal(yes.qualifies, true);
  const platform = structuredClone(input);
  for (const t of [platform.disputed, ...platform.priors]) t.device_ip_owner = 'agent_platform';
  const no = body(call('check_ce3', { input: platform }));
  assert.equal(no.qualifies, false);
  assert.ok(no.not_counted.length > 0);
});

test('mcp over stdio: a full session, one JSON line per message, nothing else on stdout', async () => {
  const child = spawn(process.execPath, [bin, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let errOut = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { errOut += d; });
  const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n');
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  child.stdin.write('this is not json\n');
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_gateways', arguments: { column: 'disputes', code: 'YES' } } });
  child.stdin.end();
  const code = await new Promise((res) => child.on('close', res));
  assert.equal(code, 0);
  assert.equal(errOut.replace(/^.*ExperimentalWarning.*\n(.*--trace-warnings.*\n)?/gm, ''), '');
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 4);
  assert.equal(lines[0].result.protocolVersion, '2025-06-18');
  assert.equal(lines[1].error.code, -32700);
  assert.equal(lines[2].result.tools.length, TOOLS.length);
  const found = JSON.parse(lines[3].result.content[0].text);
  assert.equal(found.column, 'disputes');
  assert.equal(found.count, loadScorecard().gateways.filter((g) => g.cells.disputes.code === 'YES').length);
});

test('cli: exit codes and output', () => {
  const run = (...a: string[]) => spawnSync(process.execPath, [bin, ...a], { encoding: 'utf8' });
  const list = run('gateways');
  assert.equal(list.status, 0);
  assert.match(list.stdout, /^stripe\s+YES/m);
  assert.equal(JSON.parse(run('gateways', '--json').stdout).gateways.length, loadScorecard().gateways.length);
  assert.match(run('gateway', 'adyen', 'api_field').stdout, /api_field: PART/);
  assert.match(run('find', 'accepts', 'ANN').stdout, /of 25 gateways|of \d+ gateways/);
  const vec = fileURLToPath(new URL('./fixtures/aep/b-chain.json', import.meta.url));
  assert.equal(run('verify', vec).status, 0);
  assert.equal(run('verify', vec, '--key', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=').status, 1);
  assert.equal(run('help').status, 0);
  assert.equal(run().status, 2);
  const bad = run('gateway', 'nope');
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /^aor: no gateway "nope"/);
  assert.equal(run('verify', 'no-such-file.json').status, 2);
  assert.equal(run('frobnicate').status, 2);
});
