// Reads the agent marker off a Stripe PaymentIntent the merchant already holds.
// Stripe returns it as PaymentIntent.agent_details on the preview API.
//
// Field names read 2026-11-21 from Stripe's PaymentIntent reference at
// api version 2026-09-30.preview
// (https://docs.stripe.com/api/payment_intents/object?api-version=2026-09-30.preview):
// agent_details (object, nullable), agent_details.name (string) and
// agent_details.network_business_profile (string, expandable). Stripe's seller
// guide lists it as "Agent details (Private preview)" at
// CheckoutSessions.PaymentIntent.agent_details.
//
// This code reads an object. It never calls Stripe.
import { looksLikePan } from './text.ts';

export const STRIPE_READER_SOURCES = [
  'https://docs.stripe.com/api/payment_intents/object?api-version=2026-09-30.preview',
  'https://docs.stripe.com/agentic-commerce/sellers/use-cases/retail/checkout',
  'https://docs.stripe.com/api/disputes/object',
];
export const STRIPE_READER_READ_DATE = '2026-11-21';

export interface StripeAgent {
  name: string | null;
  // The id of the agent's Stripe profile. When the caller expanded it, the id of that object.
  network_business_profile: string | null;
}

export interface StripeIntentFacts {
  status: string | null;
  amount: number | null;
  currency: string | null;
  created: string | null;
  latest_charge: string | null;
  livemode: boolean | null;
}

export interface StripeRead {
  gateway: 'stripe';
  payment_intent_id: string | null;
  // present: agent_details came back with a name or a profile.
  // empty: agent_details is an object that holds neither.
  // absent: the PaymentIntent has no agent_details, or it is null.
  // not_expanded: a Checkout Session whose payment_intent is only an id.
  marker: 'present' | 'empty' | 'absent' | 'not_expanded';
  agent: StripeAgent | null;
  intent: StripeIntentFacts;
  read_from: 'payment_intent' | 'checkout_session' | 'event';
  keep: string[];
  warnings: string[];
  sources: string[];
  read_date: string;
}

export class StripeReadRefused extends Error {
  constructor(reason: string) { super('read refused: ' + reason); this.name = 'StripeReadRefused'; }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
// An expandable field is an id, or the object with that id.
const idOf = (v: unknown): string | null => str(v) ?? (isObj(v) ? str(v.id) : null);

// Takes a PaymentIntent, a Checkout Session with payment_intent expanded, or a
// webhook event that carries either one in data.object.
export function readStripePaymentIntent(input: unknown): StripeRead {
  if (!isObj(input)) throw new StripeReadRefused('input must be a Stripe PaymentIntent, Checkout Session or event object');
  let node: Obj = input;
  let from: StripeRead['read_from'] = 'payment_intent';
  if (node.object === 'event') {
    if (!isObj(node.data) || !isObj(node.data.object)) throw new StripeReadRefused('the event has no data.object');
    node = node.data.object;
    from = 'event';
  }
  const warnings: string[] = [];
  const base = { gateway: 'stripe' as const, sources: STRIPE_READER_SOURCES, read_date: STRIPE_READER_READ_DATE };
  const noFacts: StripeIntentFacts = { status: null, amount: null, currency: null, created: null, latest_charge: null, livemode: null };

  if (node.object === 'checkout.session') {
    if (from === 'payment_intent') from = 'checkout_session';
    const pi = node.payment_intent;
    if (!isObj(pi)) {
      warnings.push('This Checkout Session holds payment_intent as ' + (str(pi) ? 'an id only' : 'nothing') + '. Retrieve the session with expand[]=payment_intent on a preview API version, then read it again.');
      return { ...base, payment_intent_id: str(pi), marker: 'not_expanded', agent: null, intent: noFacts, read_from: from, keep: [], warnings };
    }
    node = pi;
  }
  if (node.object !== 'payment_intent') {
    throw new StripeReadRefused('expected object "payment_intent", "checkout.session" or "event", got ' + JSON.stringify(node.object ?? null));
  }

  const id = str(node.id);
  const intent: StripeIntentFacts = {
    status: str(node.status),
    amount: typeof node.amount === 'number' && Number.isFinite(node.amount) ? node.amount : null,
    currency: str(node.currency),
    created: typeof node.created === 'number' && Number.isFinite(node.created) ? new Date(node.created * 1000).toISOString() : null,
    latest_charge: idOf(node.latest_charge),
    livemode: typeof node.livemode === 'boolean' ? node.livemode : null,
  };

  const ad = node.agent_details;
  let marker: StripeRead['marker'] = 'absent';
  let agent: StripeAgent | null = null;
  if (ad !== undefined && ad !== null) {
    if (!isObj(ad)) throw new StripeReadRefused('agent_details is not an object');
    agent = { name: str(ad.name), network_business_profile: idOf(ad.network_business_profile) };
    marker = agent.name !== null || agent.network_business_profile !== null ? 'present' : 'empty';
  }

  const keep: string[] = [];
  if (marker === 'present') {
    warnings.push('agent_details is on Stripe\'s preview API and the seller guide labels it private preview (pages read ' + STRIPE_READER_READ_DATE + '). The shape can change.');
    warnings.push('Stripe\'s Dispute object has no agent field (page read ' + STRIPE_READER_READ_DATE + '). If this payment is disputed, the marker comes from your own copy of this PaymentIntent, not from the dispute.');
    keep.push('PaymentIntent id', 'agent_details.name', 'agent_details.network_business_profile', 'created', 'amount and currency', 'latest_charge');
  } else if (marker === 'empty') {
    warnings.push('agent_details is there but holds no name or profile.');
  } else {
    warnings.push((('agent_details' in node) ? 'agent_details is null.' : 'No agent_details key on this object.') + ' That does not prove a person placed the order: the field is documented on the preview API version only, so an object fetched on another version may not carry it.');
  }
  if (id === null) warnings.push('no PaymentIntent id on this object');

  for (const [name, value] of [['payment_intent_id', id], ...Object.entries(intent), ...Object.entries(agent ?? {})] as Array<[string, unknown]>) {
    if (typeof value === 'string' && looksLikePan(value)) throw new StripeReadRefused('a value in ' + name + ' looks like a full card number');
  }
  return { ...base, payment_intent_id: id, marker, agent, intent, read_from: from, keep, warnings };
}
