// The read only operations behind the command line tool (bin/aor.ts) and the
// MCP server (src/mcp.ts). Nothing here sends, submits or writes anything.
import { readFileSync } from 'node:fs';
import type { ArtifactRecord, DisputeBundle } from './aep.ts';
import { verifyChain } from './aep.ts';
import { readBraintreeTransaction, ReadRefused } from './braintree.ts';
import type { Ce3Input } from './ce3.ts';
import { checkCe3 } from './ce3.ts';
import type { Code, Column, Gateway, Scorecard } from './scorecard.ts';
import { CODES, COLUMNS } from './scorecard.ts';
import type { RawPlane } from './stripe.ts';
import { RenderRefused, renderStripeEvidence } from './stripe.ts';
import { readStripePaymentIntent, StripeReadRefused } from './stripe-reader.ts';

export class BadInput extends Error {
  constructor(message: string) { super(message); this.name = 'BadInput'; }
}

export const CAVEAT = 'Cells are read from each vendor\'s own pages on the date shown. SILENT means the pages read say nothing, not that the vendor has nothing. Re-read the source page before you rely on a cell.';

let cached: Scorecard | null = null;
export function loadScorecard(): Scorecard {
  if (!cached) cached = JSON.parse(readFileSync(new URL('../data/scorecard.json', import.meta.url), 'utf8')) as Scorecard;
  return cached;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function column(name: unknown): Column {
  if (typeof name !== 'string' || !(COLUMNS as readonly string[]).includes(name)) throw new BadInput('column must be one of: ' + COLUMNS.join(', '));
  return name as Column;
}

function findGateway(card: Scorecard, key: unknown): Gateway {
  if (typeof key !== 'string' || !key.trim()) throw new BadInput('gateway is required (an id such as "stripe"; list_gateways shows them all)');
  const k = key.trim().toLowerCase();
  const hit = card.gateways.find((g) => g.id === k) ?? card.gateways.find((g) => g.name.toLowerCase() === k)
    ?? card.gateways.find((g) => g.name.toLowerCase().startsWith(k));
  if (!hit) throw new BadInput('no gateway "' + key + '". Known ids: ' + card.gateways.map((g) => g.id).join(', '));
  return hit;
}

export function listGateways(card: Scorecard = loadScorecard()) {
  return {
    read_date: card.read_date,
    columns: card.columns,
    codes: card.codes,
    gateways: card.gateways.map((g) => ({ id: g.id, name: g.name, codes: Object.fromEntries(COLUMNS.map((c) => [c, g.cells[c].code])) })),
    caveat: CAVEAT,
  };
}

export function getGateway(args: { gateway?: unknown; column?: unknown }, card: Scorecard = loadScorecard()) {
  const g = findGateway(card, args.gateway);
  const cols = args.column === undefined || args.column === null || args.column === '' ? [...COLUMNS] : [column(args.column)];
  return {
    id: g.id, name: g.name, read_date: card.read_date,
    cells: Object.fromEntries(cols.map((c) => [c, { question: card.columns[c], ...g.cells[c] }])),
    row_notes: g.row_notes, row_sources: g.row_sources, caveat: CAVEAT,
  };
}

export function findGateways(args: { column?: unknown; code?: unknown }, card: Scorecard = loadScorecard()) {
  const c = column(args.column);
  if (typeof args.code !== 'string' || !(CODES as readonly string[]).includes(args.code.toUpperCase())) throw new BadInput('code must be one of: ' + CODES.join(', '));
  const code = args.code.toUpperCase() as Code;
  const hits = card.gateways.filter((g) => g.cells[c].code === code);
  return {
    column: c, question: card.columns[c], code, meaning: card.codes[code], read_date: card.read_date,
    count: hits.length, of: card.gateways.length,
    gateways: hits.map((g) => ({ id: g.id, name: g.name, note: g.cells[c].note, sources: g.cells[c].sources })),
    caveat: CAVEAT,
  };
}

// Takes a list of artifacts, an AEP vector file (artifacts plus
// ed25519_public_key_base64) or a DisputeBundle.
export function verifyAepChain(args: { artifacts?: unknown; public_key_base64?: unknown; ed25519_public_key_base64?: unknown }) {
  if (!Array.isArray(args.artifacts) || args.artifacts.length === 0) throw new BadInput('artifacts must be a list with at least one AEP artifact record');
  for (const [i, a] of args.artifacts.entries()) {
    if (!isRecord(a) || !isRecord(a.hash_input) || typeof a.current_hash !== 'string') throw new BadInput('artifact ' + (i + 1) + ' needs hash_input and current_hash');
  }
  const key = args.public_key_base64 ?? args.ed25519_public_key_base64;
  if (key !== undefined && key !== null && typeof key !== 'string') throw new BadInput('public_key_base64 must be text');
  let check;
  try { check = verifyChain(args.artifacts as ArtifactRecord[], (key as string | undefined) || undefined); }
  catch (e) { throw new BadInput((e as Error).message); }
  return {
    ...check,
    signatures: check.signaturesValid === null ? 'not checked: no public key given' : check.signaturesValid ? 'valid' : 'invalid',
    not_checked: 'sealedBundleHash. AEP has not pinned the bundle signature rule yet, so a chain cut short at the end is not caught.',
  };
}

export function stripeEvidence(args: { bundle?: unknown; raw?: unknown; public_key_base64?: unknown; reverify?: unknown; platform_countersigned?: unknown }) {
  const b = args.bundle;
  if (!isRecord(b) || !isRecord(b.transaction) || !isRecord(b.verification) || !Array.isArray(b.artifacts) || !isRecord(b.merchantContext)) {
    throw new BadInput('bundle must be an AEP DisputeBundle with transaction, verification, artifacts and merchantContext');
  }
  if (args.raw !== undefined && args.raw !== null && !isRecord(args.raw)) throw new BadInput('raw must be an object of clear text values the merchant holds');
  if (args.public_key_base64 !== undefined && args.public_key_base64 !== null && typeof args.public_key_base64 !== 'string') throw new BadInput('public_key_base64 must be text');
  try {
    const out = renderStripeEvidence(b as unknown as DisputeBundle, (args.raw ?? {}) as RawPlane, {
      publicKeyBase64: (args.public_key_base64 as string | undefined) || undefined,
      reverify: args.reverify === false ? false : undefined,
      platformCountersigned: args.platform_countersigned === true ? true : undefined,
    });
    return { refused: false as const, ...out, note: 'Prototype. Nothing was sent to Stripe. A person reads these fields before they go on a dispute.' };
  } catch (e) {
    if (e instanceof RenderRefused) return { refused: true as const, reason: e.message };
    throw new BadInput('could not read the bundle: ' + (e as Error).message);
  }
}

export function ce3(args: { input?: unknown }) {
  const i = args.input;
  if (!isRecord(i) || typeof i.network !== 'string' || typeof i.reason_code !== 'string' || !isRecord(i.disputed) || !Array.isArray(i.priors)) {
    throw new BadInput('input needs network, reason_code, disputed and priors');
  }
  try {
    return { ...checkCe3(i as unknown as Ce3Input), note: 'Device and IP values count only when they belong to the cardholder. That is this repo\'s reading, not a Visa or Stripe rule.' };
  } catch (e) { throw new BadInput('could not read the input: ' + (e as Error).message); }
}

// Takes a Braintree transaction (or a result that holds one under "transaction")
// and says whether it carries the third party marker, and what to keep.
export function braintreeRead(args: { transaction?: unknown }) {
  if (!isRecord(args.transaction)) throw new BadInput('transaction must be a Braintree transaction object, as your own API call returned it');
  try {
    return { refused: false as const, ...readBraintreeTransaction(args.transaction), note: 'Prototype. Nothing was sent to Braintree. Field names were read from Braintree\'s pages on the date shown; the reader has not been run on a live agent order.' };
  } catch (e) {
    if (e instanceof ReadRefused) return { refused: true as const, reason: e.message };
    throw new BadInput('could not read the transaction: ' + (e as Error).message);
  }
}

// Takes a Stripe PaymentIntent (or a Checkout Session or event that holds one)
// and says whether it carries agent_details, and what to keep.
export function stripeIntentRead(args: { object?: unknown }) {
  if (!isRecord(args.object)) throw new BadInput('object must be a Stripe PaymentIntent, Checkout Session or event, as your own API call or webhook returned it');
  try {
    return { refused: false as const, ...readStripePaymentIntent(args.object), note: 'Prototype. Nothing was sent to Stripe. Field names were read from Stripe\'s preview API reference on the date shown; the reader has not been run on a live agent order.' };
  } catch (e) {
    if (e instanceof StripeReadRefused) return { refused: true as const, reason: e.message };
    throw new BadInput('could not read the object: ' + (e as Error).message);
  }
}
