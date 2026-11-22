// Reads the third party marker off a Braintree transaction the merchant already
// holds. Braintree returns it as transaction.facilitator_details, on the
// response only.
//
// Field names read 2026-11-21 from Braintree's Transaction response reference
// (https://developer.paypal.com/braintree/docs/reference/response/transaction)
// and PayPal's ACP guide
// (https://developer.paypal.com/agent-ready/agentic-commerce-protocol).
// The camelCase names are what Braintree's Node SDK hands back
// (github.com/braintree/braintree_node at 5d24276, lib/braintree/transaction.js).
//
// This code reads an object. It never calls Braintree.
import { looksLikePan } from './text.ts';

export const BRAINTREE_SOURCES = [
  'https://developer.paypal.com/braintree/docs/reference/response/transaction',
  'https://developer.paypal.com/agent-ready/agentic-commerce-protocol',
  'https://developer.paypal.com/braintree/docs/reference/response/dispute',
];
export const BRAINTREE_READ_DATE = '2026-11-21';

export interface BraintreeFacilitator {
  oauth_application_name: string | null;
  oauth_application_client_id: string | null;
  // The token itself points into the facilitator's Vault, so it is not copied out.
  has_source_payment_method_token: boolean;
}

export interface BraintreeOrderFacts {
  status: string | null;
  amount: string | null;
  currency_iso_code: string | null;
  merchant_account_id: string | null;
  order_id: string | null;
  created_at: string | null;
  payment_instrument_type: string | null;
  network_transaction_id: string | null;
}

export interface BraintreeRead {
  gateway: 'braintree';
  transaction_id: string | null;
  // present: facilitator_details came back with an application name or client id.
  // empty: the key is there but holds neither.
  // absent: no facilitator_details on this object.
  marker: 'present' | 'empty' | 'absent';
  facilitator: BraintreeFacilitator | null;
  order: BraintreeOrderFacts;
  keep: string[];
  warnings: string[];
  sources: string[];
  read_date: string;
}

export class ReadRefused extends Error {
  constructor(reason: string) { super('read refused: ' + reason); this.name = 'ReadRefused'; }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// Both spellings: snake_case (Ruby, Python, PHP, the docs) and camelCase (Node, Java, .NET shapes).
function pick(o: Obj, snake: string): unknown {
  if (snake in o) return o[snake];
  const camel = snake.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return o[camel];
}
function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString();
  return null;
}

// Takes the transaction itself, or a result wrapper that holds it under
// "transaction" (what the SDK's sale and find calls hand back).
export function readBraintreeTransaction(input: unknown): BraintreeRead {
  if (!isObj(input)) throw new ReadRefused('input must be a Braintree transaction object');
  const tx = isObj(input.transaction) ? input.transaction : input;
  const id = text(tx.id);
  const order: BraintreeOrderFacts = {
    status: text(pick(tx, 'status')),
    amount: text(pick(tx, 'amount')),
    currency_iso_code: text(pick(tx, 'currency_iso_code')),
    merchant_account_id: text(pick(tx, 'merchant_account_id')),
    order_id: text(pick(tx, 'order_id')),
    created_at: text(pick(tx, 'created_at')),
    payment_instrument_type: text(pick(tx, 'payment_instrument_type')),
    network_transaction_id: text(pick(tx, 'network_transaction_id')),
  };
  if (id === null && order.amount === null && order.status === null) {
    throw new ReadRefused('this does not look like a Braintree transaction: no id, amount or status');
  }

  const warnings: string[] = [];
  const fd = pick(tx, 'facilitator_details');
  let marker: BraintreeRead['marker'] = 'absent';
  let facilitator: BraintreeFacilitator | null = null;
  if (fd !== undefined && fd !== null) {
    if (!isObj(fd)) throw new ReadRefused('facilitator_details is not an object');
    facilitator = {
      oauth_application_name: text(pick(fd, 'oauth_application_name')),
      oauth_application_client_id: text(pick(fd, 'oauth_application_client_id')),
      has_source_payment_method_token: text(pick(fd, 'source_payment_method_token')) !== null,
    };
    marker = facilitator.oauth_application_name !== null || facilitator.oauth_application_client_id !== null ? 'present' : 'empty';
  }

  const keep: string[] = [];
  if (marker === 'present') {
    // Braintree's reference describes the field as third party payment
    // information in general. It is older than agent checkout.
    warnings.push('facilitator_details names the OAuth application that owned the payment information. Braintree fills it for any third party, not only AI agents, so the application name is what says who placed the order.');
    warnings.push('Braintree\'s Dispute object has no facilitator field (page read ' + BRAINTREE_READ_DATE + '). If this order is disputed, the marker comes from your own copy of this transaction, not from the dispute.');
    keep.push('transaction id', 'facilitator_details.oauth_application_name', 'facilitator_details.oauth_application_client_id', 'created_at', 'amount and currency_iso_code', 'order_id');
  } else if (marker === 'empty') {
    warnings.push('facilitator_details is there but holds no application name or client id.');
  } else {
    warnings.push('No facilitator_details on this object. That does not prove a person placed the order: PayPal\'s guide documents the field for delegated payment tokens (ACP), and the scorecard found no agent field documented for the UCP path.');
  }
  if (id === null) warnings.push('no transaction id on this object');

  const out: BraintreeRead = { gateway: 'braintree', transaction_id: id, marker, facilitator, order, keep, warnings, sources: BRAINTREE_SOURCES, read_date: BRAINTREE_READ_DATE };
  // Same rule as the Stripe renderer: nothing that looks like a full card number leaves.
  for (const [name, value] of [['transaction_id', id], ...Object.entries(order), ...Object.entries(facilitator ?? {})] as Array<[string, unknown]>) {
    if (typeof value === 'string' && looksLikePan(value)) throw new ReadRefused('a value in ' + name + ' looks like a full card number');
  }
  return out;
}
