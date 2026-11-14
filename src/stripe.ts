// AEP DisputeBundle to Stripe dispute evidence.
// Follows AEP v1.0.3-rc.2 Appendix C (field map) and sections 6.2, 6.5, 8.3.
// Field names and length limits are checked in tests against Stripe's public
// OpenAPI file (test/fixtures/stripe/evidence-param.json).
//
// This code builds the evidence. It never calls Stripe, uploads a file, or
// submits a dispute. The caller does that.
import type { ArtifactRecord, ArtifactType, DisputeBundle } from './aep.ts';
import { verifyChain } from './aep.ts';
import { hashPrefix, looksLikePan, money, panShaped, SEP_CLASS, truncate } from './text.ts';

// Clear text values the merchant (or its evidence custodian) holds outside the
// chain. AEP 8.2.1 calls this the raw plane. The chain itself only has hashes,
// and a hash is not an IP address, so these are never filled from the chain.
export interface RawPlane {
  customer_purchase_ip?: string;
  customer_email_address?: string;
  customer_name?: string;
  shipping_address?: string;
}

export interface StripeRenderOptions {
  // Public key to re-check artifact signatures. Without it only hashes are re-checked.
  publicKeyBase64?: string;
  // Set true only when the named AI platform countersigned its attribution (AEP 6.5).
  platformCountersigned?: boolean;
  // Set false to skip the local chain re-check and trust bundle.verification.
  reverify?: boolean;
}

export type StripeTextField =
  | 'product_description' | 'customer_purchase_ip' | 'customer_email_address' | 'customer_name'
  | 'shipping_address' | 'shipping_carrier' | 'shipping_date' | 'shipping_tracking_number'
  | 'access_activity_log' | 'uncategorized_text';

export type StripeFileField = 'customer_communication' | 'receipt' | 'shipping_documentation';

export interface StripeEvidence {
  // Text evidence, ready for the evidence hash on POST /v1/disputes/{id}.
  evidence: Partial<Record<StripeTextField, string>>;
  // Page text for the three file evidence fields. The caller renders each to a
  // PDF, uploads it with purpose dispute_evidence, and sets the field to the file ID.
  documents: Record<StripeFileField, string>;
  omitted: Array<{ field: string; reason: string }>;
  warnings: string[];
}

export class RenderRefused extends Error {
  constructor(reason: string) { super('render refused: ' + reason); this.name = 'RenderRefused'; }
}

// Stripe write limits, read 2026-11-09 from the evidence parameter of
// POST /v1/disputes/{dispute} in its OpenAPI file (api version 2026-09-30.endive).
// The update call takes 20,000 per long field and 150,000 across all fields
// together (Stripe's update page states the combined limit).
const SHORT = 5000;
const LONG = 20000;
export const STRIPE_TEXT_LIMITS: Record<StripeTextField, number> = {
  product_description: LONG, customer_purchase_ip: SHORT, customer_email_address: SHORT, customer_name: SHORT,
  shipping_address: SHORT, shipping_carrier: SHORT, shipping_date: SHORT, shipping_tracking_number: SHORT,
  access_activity_log: LONG, uncategorized_text: LONG,
};
// AEP Appendix C: combined text evidence is about 150,000 characters.
const COMBINED_TEXT = 150000;

function find(bundle: DisputeBundle, type: ArtifactType): ArtifactRecord | undefined {
  return bundle.artifacts.find((a) => a.artifact_type === type);
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}
function yes(b: boolean): string { return b ? 'YES' : 'NO'; }
function hashLine(a: ArtifactRecord): string {
  return 'Artifact hash: ' + a.current_hash + '\nPrevious hash: ' + (a.hash_input.previous_hash ?? 'none (first artifact)');
}

function productDescription(bundle: DisputeBundle): string | null {
  const cart = find(bundle, 'cart');
  const intent = find(bundle, 'intent');
  const lines: string[] = [];
  const cp = cart?.hash_input.payload;
  const items = cp && Array.isArray(cp.items) ? (cp.items as Array<Record<string, unknown>>) : [];
  const currency = cp?.currency ?? intent?.hash_input.payload.currency;
  for (const it of items) {
    lines.push((str(it.product_name) ?? str(it.product_id) ?? 'item') + ', quantity ' + String(it.quantity ?? 1) + ', unit price ' + money(it.unit_price, currency));
  }
  if (lines.length === 0 && intent) {
    const p = intent.hash_input.payload;
    lines.push((str(p.product_name) ?? str(p.product_id) ?? 'item') + ', quantity ' + String(p.quantity ?? 1) + ', unit price ' + money(p.unit_price, p.currency));
  }
  if (lines.length === 0) return null;
  if (cp && typeof cp.total === 'number') lines.push('Order total ' + money(cp.total, currency) + (cp.confirmed === true ? ', cart confirmed at ' + (str(cp.cart_confirmed_at) ?? 'time not recorded') + ' by actor type ' + cart!.hash_input.actor_type : ''));
  return lines.join('\n');
}

function accessLog(bundle: DisputeBundle): string | null {
  const ref = find(bundle, 'referral');
  if (!ref) return null;
  const p = ref.hash_input.payload;
  const lines = ['Session start: ' + ref.hash_input.timestamp];
  if (str(p.referral_event_id)) lines.push('Referral event ID: ' + p.referral_event_id);
  if (str(p.consumer_ip_country)) lines.push('IP country: ' + p.consumer_ip_country);
  if (typeof p.consent_gpc === 'boolean') lines.push('Global Privacy Control signal: ' + (p.consent_gpc ? 'on' : 'off'));
  if (str(p.consent_cookie)) lines.push('Cookie consent: ' + p.consent_cookie);
  const cart = find(bundle, 'cart');
  if (cart) lines.push('Cart confirmed: ' + (str(cart.hash_input.payload.cart_confirmed_at) ?? cart.hash_input.timestamp));
  const auth = find(bundle, 'authorization');
  if (auth) lines.push('Payment authorized: ' + (str(auth.hash_input.payload.authorized_at) ?? auth.hash_input.timestamp));
  return lines.join('\n');
}

function attributionNote(opts: StripeRenderOptions): string {
  return opts.platformCountersigned ? '' : ' (platform attribution is not verified by the named platform)';
}

function chainSummary(bundle: DisputeBundle, opts: StripeRenderOptions): string {
  const v = bundle.verification;
  const t = bundle.transaction;
  const out: string[] = [];
  out.push('AEP EVIDENCE HASH CHAIN, VERIFICATION SUMMARY');
  out.push('Protocol: A-Comm Evidence Protocol (AEP), open spec, Apache 2.0');
  out.push('Exported: ' + bundle.exportedAt);
  out.push('');
  out.push('CHAIN INTEGRITY');
  out.push('Chain valid: ' + yes(v.valid));
  out.push('Hash chain intact: ' + yes(v.hashChainIntact));
  out.push('Signatures valid: ' + yes(v.signaturesValid));
  out.push('Chain complete: ' + yes(v.chainComplete));
  if (bundle.evidenceTier) out.push('Evidence tier: ' + bundle.evidenceTier);
  out.push('Artifacts verified: ' + v.artifactsVerified);
  out.push('');
  out.push('TRANSACTION');
  out.push('ID: ' + t.id);
  out.push('Type: ' + t.transactionType);
  if (t.interactionChannel) out.push('Channel: ' + t.interactionChannel);
  out.push('Created: ' + t.createdAt);
  if (t.completedAt) out.push('Completed: ' + t.completedAt);
  if (t.sealedBundleHash) out.push('Sealed bundle hash: ' + t.sealedBundleHash);
  const disc = find(bundle, 'discovery');
  if (disc && str(disc.hash_input.payload.platform)) out.push('AI platform: ' + disc.hash_input.payload.platform + attributionNote(opts));
  out.push('');
  out.push('ARTIFACT SEQUENCE');
  for (const a of bundle.artifacts) {
    out.push('[' + a.sequence_number + '] ' + a.artifact_type.padEnd(14) + ' actor=' + a.hash_input.actor_type.padEnd(20) + ' hash=' + hashPrefix(a.current_hash));
  }
  return out.join('\n');
}

function communicationDoc(bundle: DisputeBundle, opts: StripeRenderOptions): string {
  const out: string[] = ['AUTHORIZATION TRAIL', 'Transaction ' + bundle.transaction.id, ''];
  const disc = find(bundle, 'discovery');
  if (disc) {
    const p = disc.hash_input.payload;
    out.push('1. Discovery, ' + disc.hash_input.timestamp);
    out.push('AI platform: ' + (str(p.platform) ?? 'not recorded') + attributionNote(opts));
    if (str(p.product_url_cited)) out.push('Product page cited: ' + p.product_url_cited);
    if (str(p.attribution_method)) out.push('Attribution method: ' + p.attribution_method + ', confidence ' + (str(p.attribution_confidence) ?? 'not recorded'));
    out.push(hashLine(disc), '');
  }
  const intent = find(bundle, 'intent');
  if (intent) {
    const p = intent.hash_input.payload;
    out.push('2. Intent, ' + intent.hash_input.timestamp);
    out.push('Product: ' + (str(p.product_name) ?? str(p.product_id) ?? 'not recorded') + ', quantity ' + String(p.quantity ?? 'not recorded'));
    out.push('Actor: ' + intent.hash_input.actor_type + ' ' + intent.hash_input.actor_id + ', channel ' + (intent.hash_input.interaction_channel ?? 'not recorded'));
    out.push(hashLine(intent), '');
  }
  const cart = find(bundle, 'cart');
  if (cart) {
    const p = cart.hash_input.payload;
    const n = Array.isArray(p.items) ? p.items.length : 0;
    out.push('3. Cart, ' + cart.hash_input.timestamp);
    out.push('Confirmed: ' + (p.confirmed === true ? 'yes' : 'no') + ', actor type ' + cart.hash_input.actor_type + ', items ' + n + ', total ' + money(p.total, p.currency));
    out.push(hashLine(cart), '');
  }
  const del = find(bundle, 'delegation');
  if (del) {
    const pm = (del.hash_input.payload.protocol_metadata ?? {}) as Record<string, unknown>;
    out.push('4. Delegation, ' + del.hash_input.timestamp);
    out.push('Protocol: ' + (str(pm.protocol) ?? 'not recorded') + (bundle.evidenceTier ? ', evidence tier ' + bundle.evidenceTier : ''));
    const env = bundle.protocolEnvelopesVerified ?? [];
    out.push('Protocol envelopes verified: ' + (env.length ? env.length : 'none'));
    out.push(hashLine(del), '');
  }
  return out.join('\n').trimEnd();
}

function receiptDoc(bundle: DisputeBundle): string {
  const t = bundle.transaction;
  const out: string[] = ['RECEIPT AND AUTHORIZATION RECORD', 'Transaction chain ID: ' + t.id, 'Transaction type: ' + t.transactionType, 'Chain status at export: ' + t.status];
  const auth = find(bundle, 'authorization');
  if (!auth) { out.push('', 'No authorization artifact recorded.'); return out.join('\n'); }
  const p = auth.hash_input.payload;
  out.push('Authorized at: ' + (str(p.authorized_at) ?? auth.hash_input.timestamp));
  out.push('Actor: ' + auth.hash_input.actor_type + ' ' + auth.hash_input.actor_id);
  if (str(p.payment_method_token)) out.push('Payment method token: ' + p.payment_method_token);
  if (str(p.psp)) out.push('Payment provider: ' + p.psp);
  if (str(p.auth_code)) out.push('Authorization code: ' + p.auth_code);
  out.push('Amount authorized: ' + money(p.amount, p.currency));
  if (str(p.card_brand) && str(p.card_last4)) out.push('Card: ' + p.card_brand + ' ending ' + p.card_last4);
  if (str(p.avs_result)) out.push('AVS result: ' + p.avs_result);
  if (str(p.cvv_result)) out.push('CVV result: ' + p.cvv_result);
  if (t.sealedBundleHash) out.push('Sealed bundle hash: ' + t.sealedBundleHash);
  out.push(hashLine(auth));
  return out.join('\n');
}

function shippingDoc(bundle: DisputeBundle): string {
  const f = find(bundle, 'fulfillment');
  if (!f) return 'SHIPPING RECORD\nTransaction ' + bundle.transaction.id + '\n\nNo fulfillment artifact recorded.';
  const p = f.hash_input.payload;
  const out = ['SHIPPING RECORD', 'Transaction ' + bundle.transaction.id];
  out.push('Carrier: ' + (str(p.carrier) ?? 'not recorded'));
  out.push('Tracking number: ' + (str(p.tracking_number) ?? 'not recorded'));
  if (str(p.tracking_url)) out.push('Tracking URL: ' + p.tracking_url);
  out.push('Status: ' + (str(p.status) ?? 'not recorded'));
  out.push('Shipped at: ' + (str(p.shipped_at) ?? 'not recorded'));
  out.push('Delivered at: ' + (str(p.delivered_at) ?? 'not recorded'));
  if (typeof p.delivery_address_match === 'boolean') out.push('Delivery address matches the cart address: ' + (p.delivery_address_match ? 'yes' : 'no'));
  out.push(hashLine(f));
  return out.join('\n');
}

export function renderStripeEvidence(bundle: DisputeBundle, raw: RawPlane = {}, opts: StripeRenderOptions = {}): StripeEvidence {
  const v = bundle.verification;
  // AEP 6.2: a bundle that failed verification, or that carries only a cached
  // result, must not be exported for submission.
  if (!v || v.valid !== true) throw new RenderRefused('bundle verification is not valid' + (v?.errors?.length ? ': ' + v.errors.join('; ') : ''));
  if (v.verificationMode === 'cached') throw new RenderRefused('verification is cached; a full re-verification is required before a dispute export');
  if (v.hashChainIntact === false || v.signaturesValid === false) throw new RenderRefused('bundle verification contradicts itself: valid is true but the hash chain or signatures are marked failed');
  if (!Array.isArray(bundle.artifacts) || bundle.artifacts.length === 0) throw new RenderRefused('bundle has no artifacts');
  if (typeof v.artifactsVerified === 'number' && v.artifactsVerified !== bundle.artifacts.length) throw new RenderRefused('bundle says ' + v.artifactsVerified + ' artifacts were verified but holds ' + bundle.artifacts.length);
  const warnings: string[] = [];
  if (opts.reverify !== false) {
    const check = verifyChain(bundle.artifacts, opts.publicKeyBase64);
    if (!check.hashChainIntact || check.signaturesValid === false) throw new RenderRefused('local chain re-check failed: ' + check.errors.join('; '));
    if (check.signaturesValid === null) warnings.push('signatures not re-checked here: no public key given');
  } else {
    warnings.push('local chain re-check skipped by option');
  }

  const evidence: Partial<Record<StripeTextField, string>> = {};
  const omitted: Array<{ field: string; reason: string }> = [];
  const put = (field: StripeTextField, value: string | null | undefined, why: string) => {
    if (value === null || value === undefined || value.trim() === '') { omitted.push({ field, reason: why }); return; }
    const cut = truncate(value, STRIPE_TEXT_LIMITS[field]);
    if (cut.truncated) warnings.push(field + ' was cut to ' + STRIPE_TEXT_LIMITS[field] + ' characters');
    evidence[field] = cut.text;
  };

  put('product_description', productDescription(bundle), 'no cart or intent artifact in the bundle');
  const rawWhy = 'raw plane value not supplied; the chain holds only a hash';
  put('customer_purchase_ip', raw.customer_purchase_ip, rawWhy);
  put('customer_email_address', raw.customer_email_address, rawWhy);
  put('customer_name', raw.customer_name, rawWhy);
  put('shipping_address', raw.shipping_address, rawWhy);
  const f = find(bundle, 'fulfillment');
  const fp = f?.hash_input.payload;
  const noF = 'no fulfillment artifact in the bundle';
  put('shipping_carrier', fp ? str(fp.carrier) : null, f ? 'carrier not recorded' : noF);
  put('shipping_date', fp ? str(fp.shipped_at) : null, f ? 'ship date not recorded' : noF);
  put('shipping_tracking_number', fp ? str(fp.tracking_number) : null, f ? 'tracking number not recorded' : noF);
  put('access_activity_log', accessLog(bundle), 'no referral artifact in the bundle');
  put('uncategorized_text', chainSummary(bundle, opts), 'no chain summary');

  // Keep the whole text package inside the combined budget by trimming the
  // summary, which is the one field that can grow without limit.
  const total = () => Object.values(evidence).reduce((n, s) => n + (s ? s.length : 0), 0);
  if (total() > COMBINED_TEXT && evidence.uncategorized_text) {
    const room = Math.max(0, COMBINED_TEXT - (total() - evidence.uncategorized_text.length));
    evidence.uncategorized_text = truncate(evidence.uncategorized_text, room).text;
    warnings.push('uncategorized_text was cut to keep combined text under ' + COMBINED_TEXT + ' characters');
  }

  const documents: Record<StripeFileField, string> = {
    customer_communication: communicationDoc(bundle, opts),
    receipt: receiptDoc(bundle),
    shipping_documentation: shippingDoc(bundle),
  };

  // AEP 8.3: no card number may leave in evidence. The tracking number is a
  // long digit string by nature, so it gets its own, narrower test (card brand
  // prefix plus Luhn on the whole value). Where a real tracking number (8
  // characters or more) shows up inside other text it is swapped for a word
  // before the wider test, never deleted, so it cannot hide digits around it.
  // Only a copy that stands alone is swapped: one glued to other digits, or
  // split from them by a separator, stays, so a tracking value that happens to
  // sit inside a card number cannot hide it.
  const tracking = evidence.shipping_tracking_number;
  if (tracking && panShaped(tracking.replace(/\D/g, ''))) throw new RenderRefused('a value in shipping_tracking_number looks like a full card number');
  const alone = tracking && tracking.length >= 8
    ? new RegExp('(?<![\\p{L}\\p{N}])(?<!\\d' + SEP_CLASS + '{1,5})' + tracking.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}])(?!' + SEP_CLASS + '{1,5}\\d)', 'gu')
    : null;
  const mask = (s: string) => (alone ? s.replace(alone, ' [tracking] ') : s);
  for (const [name, text] of [...Object.entries(evidence), ...Object.entries(documents)]) {
    if (name === 'shipping_tracking_number') continue;
    if (text && looksLikePan(mask(text))) throw new RenderRefused('a value in ' + name + ' looks like a full card number');
  }

  return { evidence, documents, omitted, warnings };
}
