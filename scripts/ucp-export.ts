// Writes each test scenario as the input the UCP conformance receipt verifier
// takes (issuers, mandates, order), so a reader other than this repo can judge
// the receipts. Usage: node scripts/ucp-export.ts <out dir>
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripeToReceipts } from '../src/ucp-receipts.ts';
import { scenarios } from '../test/fixtures/stripe-events/scenarios.ts';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: node scripts/ucp-export.ts <out dir>');
mkdirSync(outDir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const iss = 'https://merchant.example/.well-known/ucp';
const kid = 'test_only_adapter';

for (const s of scenarios) {
  const mandateToken = 'test_only_payment_mandate_' + s.name;
  const chain = stripeToReceipts(s.events, {
    iss, order_id: 'order_' + s.name, checkout_id: 'chk_' + s.name, mandateToken, mandated: s.mandated,
    privateJwk: privateKey.export({ format: 'jwk' }), kid, overcapture: s.overcapture,
  });
  const doc = {
    id: s.name,
    source: 'agent-order-record stripeToReceipts, hand built Stripe event shapes',
    halted: chain.halted,
    unmapped: chain.unmapped,
    inputs: {
      issuers: { [iss]: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'ES256' }] } },
      mandates: [{ credential_token: mandateToken, business: iss, payment_amount: s.mandated }],
      order: {
        id: 'order_' + s.name, checkout_id: 'chk_' + s.name, currency: 'USD',
        line_items: [{ id: 'li_1', totals: [{ type: 'total', amount: s.mandated }] }],
        adjustments: (s.adjustments ?? []).map((a) => ({ id: a.id, type: 'refund', status: 'completed', totals: [{ type: 'total', amount: a.total }] })),
        totals: [{ type: 'total', amount: s.mandated }],
        ap2: { receipts: chain.receipts },
      },
    },
  };
  writeFileSync(join(outDir, s.name + '.json'), JSON.stringify(doc, null, 2) + '\n');
}
console.log(`wrote ${scenarios.length} files to ${outDir}`);
