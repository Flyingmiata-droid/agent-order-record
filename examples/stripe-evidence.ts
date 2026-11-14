// Run: node examples/stripe-evidence.ts
// Takes AEP conformance vector b (a real signed artifact chain), wraps it in a
// DisputeBundle, and prints what a merchant would paste into Stripe dispute
// evidence. Nothing is sent anywhere.
import { readFileSync } from 'node:fs';
import type { DisputeBundle } from '../src/aep.ts';
import { verifyChain } from '../src/aep.ts';
import { renderStripeEvidence } from '../src/stripe.ts';

const v = JSON.parse(readFileSync(new URL('../test/fixtures/aep/b-chain.json', import.meta.url), 'utf8'));
const check = verifyChain(v.artifacts, v.ed25519_public_key_base64);
console.log('chain: ' + check.artifactsVerified + ' artifacts, hashes ' + (check.hashChainIntact ? 'intact' : 'BROKEN') + ', signatures ' + (check.signaturesValid === true ? 'valid' : 'not checked or invalid'));

// AEP has not published a signed DisputeBundle vector yet (vector c is pending),
// so the bundle wrapper below is ours. The artifacts inside it are AEP's.
const bundle: DisputeBundle = {
  transaction: { id: 'txn_vector_b', transactionType: v.transaction_type, status: 'sealed', interactionChannel: 'text_chat', createdAt: '2026-07-01T12:00:00Z', completedAt: '2026-07-01T12:46:00Z', sealedBundleHash: v.sealed_bundle_hash },
  verification: { valid: true, hashChainIntact: check.hashChainIntact, signaturesValid: check.signaturesValid === true, chainComplete: true, artifactsVerified: check.artifactsVerified, verifiedAt: '2026-07-02T00:00:00Z', verificationMode: 'full', errors: [] },
  artifacts: v.artifacts,
  merchantContext: { merchantId: 'acct_vector_merchant', merchantName: 'Vector Merchant', totalValue: '5500', currency: 'USD' },
  evidenceTier: 'D',
  protocolEnvelopesVerified: [],
  customerHistory: null,
  exportedAt: '2026-07-02T00:00:00Z',
};
// Clear text the merchant holds outside the chain. Made up values.
const raw = { customer_purchase_ip: '203.0.113.7', customer_email_address: 'buyer@example.com', customer_name: 'Test Buyer', shipping_address: '1 Example St, Springfield, IL 62701, US' };

const out = renderStripeEvidence(bundle, raw, { publicKeyBase64: v.ed25519_public_key_base64 });
console.log('\ntext fields for POST /v1/disputes/{id} evidence:');
for (const [k, val] of Object.entries(out.evidence)) console.log('  ' + k + ' (' + val.length + ' chars): ' + val.slice(0, 90).replace(/\n/g, ' ') + (val.length > 90 ? ' ...' : ''));
console.log('\npage text for the file fields (you make the PDF and upload it):');
for (const [k, val] of Object.entries(out.documents)) console.log('  ' + k + ': ' + val.length + ' chars');
console.log('\nomitted: ' + JSON.stringify(out.omitted));
console.log('warnings: ' + JSON.stringify(out.warnings));
