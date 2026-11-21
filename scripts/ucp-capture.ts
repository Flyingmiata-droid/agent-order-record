// Runs card flows in a Stripe SANDBOX and saves the events Stripe really sends,
// cut down to the members src/ucp-receipts.ts reads.
//
//   set STRIPE_TEST_KEY=rk_test_...
//   node scripts/ucp-capture.ts
//
// Refuses any key that is not a test key. Uses Stripe's test payment methods
// only. Writes test/fixtures/stripe-events/captured/<flow>.json. The key is
// read from the environment and never written anywhere.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const key = process.env.STRIPE_TEST_KEY ?? '';
if (!/^(rk|sk)_test_/.test(key)) {
  console.error('STRIPE_TEST_KEY must be a test mode key (rk_test_ or sk_test_). Nothing was run.');
  process.exit(2);
}
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'stripe-events', 'captured');
mkdirSync(outDir, { recursive: true });

type Obj = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(method: 'GET' | 'POST', path: string, params: Record<string, string | number | boolean> = {}): Promise<Obj> {
  const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = 'https://api.stripe.com/v1' + path + (method === 'GET' && body.size ? '?' + body : '');
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? body : undefined,
  });
  const json = (await res.json()) as Obj;
  if (!res.ok) throw new Error(`${method} ${path}: ${json.error?.code ?? res.status} ${json.error?.message ?? ''}`.trim());
  return json;
}

const pi = (amount: number, pm: string, extra: Record<string, string | number | boolean> = {}) =>
  api('POST', '/payment_intents', {
    amount, currency: 'usd', payment_method: pm, confirm: true, 'payment_method_types[]': 'card',
    description: 'agent-order-record sandbox capture', ...extra,
  });
const capture = (id: string, params: Record<string, string | number | boolean> = {}) => api('POST', `/payment_intents/${id}/capture`, params);
const refund = (id: string, amount?: number) =>
  api('POST', '/refunds', { payment_intent: id, ...(amount ? { amount } : {}), 'metadata[ucp_adjustment_id]': 'adj_refund_1' });

// Keep only what the adapter reads, plus the few members that show which path Stripe took.
function trim(e: Obj): Obj {
  const o = e.data.object as Obj;
  const base: Obj = { id: o.id, object: o.object };
  if (o.object === 'charge') {
    Object.assign(base, {
      amount: o.amount, amount_captured: o.amount_captured, amount_refunded: o.amount_refunded, captured: o.captured,
      currency: o.currency, created: o.created, payment_intent: o.payment_intent, status: o.status,
      payment_method_details: { card: {
        amount_authorized: o.payment_method_details?.card?.amount_authorized ?? null,
        overcapture: o.payment_method_details?.card?.overcapture ?? null,
        multicapture: o.payment_method_details?.card?.multicapture ?? null,
        incremental_authorization: o.payment_method_details?.card?.incremental_authorization ?? null,
      } },
    });
  } else if (o.object === 'payment_intent') {
    Object.assign(base, {
      amount: o.amount, amount_capturable: o.amount_capturable, amount_received: o.amount_received,
      currency: o.currency, status: o.status, capture_method: o.capture_method, cancellation_reason: o.cancellation_reason ?? null,
    });
  } else if (o.object === 'refund') {
    Object.assign(base, {
      amount: o.amount, currency: o.currency, created: o.created, status: o.status, charge: o.charge,
      payment_intent: o.payment_intent, failure_reason: o.failure_reason ?? null,
      metadata: o.metadata ?? {},
      destination_details: o.destination_details ? { type: o.destination_details.type, card: o.destination_details.card ?? null } : null,
    });
  }
  return { id: e.id, type: e.type, created: e.created, api_version: e.api_version, data: { object: base } };
}

async function eventsFor(ids: Set<string>, since: number): Promise<Obj[]> {
  const out: Obj[] = [];
  let starting_after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const list = await api('GET', '/events', { limit: 100, 'created[gte]': since, ...(starting_after ? { starting_after } : {}) });
    for (const e of list.data as Obj[]) {
      const o = e.data.object as Obj;
      if (ids.has(o.id) || ids.has(o.payment_intent) || ids.has(o.charge)) out.push(e);
    }
    if (!list.has_more) break;
    starting_after = list.data[list.data.length - 1].id;
  }
  // Stripe lists newest first. Oldest first is the order a webhook endpoint sees, near enough.
  return out.sort((a, b) => a.created - b.created || String(a.id).localeCompare(String(b.id)));
}

interface Flow { name: string; run: () => Promise<{ piId: string; waitFor?: string }> }
const manual = { capture_method: 'manual' };

const flows: Flow[] = [
  { name: 'auto_capture', run: async () => ({ piId: (await pi(5400, 'pm_card_visa')).id }) },
  { name: 'manual_partial_capture', run: async () => {
    const p = await pi(5400, 'pm_card_visa', manual);
    await capture(p.id, { amount_to_capture: 3000 });
    return { piId: p.id };
  } },
  { name: 'canceled_before_capture', run: async () => {
    const p = await pi(5400, 'pm_card_visa', manual);
    await api('POST', `/payment_intents/${p.id}/cancel`);
    return { piId: p.id };
  } },
  { name: 'multicapture_two_shipments', run: async () => {
    const p = await pi(5400, 'pm_card_visa', { ...manual, 'payment_method_options[card][request_multicapture]': 'if_available' });
    await capture(p.id, { amount_to_capture: 3000, final_capture: false });
    await capture(p.id, { amount_to_capture: 2400, final_capture: true });
    return { piId: p.id };
  } },
  { name: 'incremental_authorization', run: async () => {
    const p = await pi(5400, 'pm_card_visa', { ...manual, 'payment_method_options[card][request_incremental_authorization]': 'if_available' });
    await api('POST', `/payment_intents/${p.id}/increment_authorization`, { amount: 6500 });
    await capture(p.id);
    return { piId: p.id };
  } },
  { name: 'overcapture', run: async () => {
    const p = await pi(5000, 'pm_card_visa', { ...manual, 'payment_method_options[card][request_overcapture]': 'if_available' });
    await capture(p.id, { amount_to_capture: 5800 });
    return { piId: p.id };
  } },
  { name: 'refund_partial', run: async () => {
    const p = await pi(5400, 'pm_card_visa');
    await refund(p.id, 2000);
    return { piId: p.id };
  } },
  { name: 'refund_pending_then_succeeds', run: async () => {
    const p = await pi(5400, 'pm_card_pendingRefund');
    await refund(p.id);
    return { piId: p.id, waitFor: 'refund.updated' };
  } },
  { name: 'refund_succeeds_then_fails', run: async () => {
    const p = await pi(5400, 'pm_card_refundFail');
    await refund(p.id);
    return { piId: p.id, waitFor: 'refund.failed' };
  } },
];

// node scripts/ucp-capture.ts --recheck
// Reads the saved flows again and asks Stripe for any events that arrived since,
// such as a refund that settles or fails later. Makes no new payments.
if (process.argv.includes('--recheck')) {
  for (const file of readdirSync(outDir).filter((x) => x.endsWith('.json'))) {
    const doc = JSON.parse(readFileSync(join(outDir, file), 'utf8')) as Obj;
    const piId = (doc.events as Obj[]).map((e) => e.data.object).find((o: Obj) => o.object === 'payment_intent')?.id;
    if (!piId) continue;
    const since = Math.min(...(doc.events as Obj[]).map((e) => e.created)) - 5;
    const events = (await eventsFor(new Set([piId]), since)).map(trim);
    const added = events.length - doc.events.length;
    doc.events = events;
    doc.rechecked_at = new Date().toISOString();
    writeFileSync(join(outDir, file), JSON.stringify(doc, null, 2) + '\n');
    console.log(`${doc.flow}: ${events.length} events` + (added > 0 ? ` (${added} new: ${events.slice(-added).map((e) => e.type).join(', ')})` : ''));
  }
  process.exit(0);
}

const startedAll = Math.floor(Date.now() / 1000) - 5;
for (const f of flows) {
  const doc: Obj = { flow: f.name, source: 'Stripe sandbox, captured by scripts/ucp-capture.ts', captured_at: new Date().toISOString() };
  try {
    const { piId, waitFor } = await f.run();
    const ids = new Set([piId]);
    let events: Obj[] = [];
    // Stripe posts some refund changes a little later. Poll for up to 90 seconds when a flow expects one.
    for (let i = 0; i < (waitFor ? 18 : 2); i++) {
      await sleep(5000);
      events = await eventsFor(ids, startedAll);
      if (!waitFor || events.some((e) => e.type === waitFor)) break;
    }
    doc.events = events.map(trim);
    doc.saw_expected_event = waitFor ? events.some((e) => e.type === waitFor) : null;
    console.log(`ok   ${f.name}: ${events.length} events` + (waitFor && !doc.saw_expected_event ? ` (no ${waitFor} within 90s)` : ''));
  } catch (err) {
    doc.error = (err as Error).message;
    doc.events = [];
    console.log(`skip ${f.name}: ${doc.error}`);
  }
  writeFileSync(join(outDir, f.name + '.json'), JSON.stringify(doc, null, 2) + '\n');
}
console.log('saved to ' + outDir);
