// Reads the agent marker off Adyen objects the merchant already holds. Adyen
// has no one field for it, so the reader takes three shapes:
//
//   1. a standard webhook item (eventCode AUTHORISATION). Adyen's Agentic Cart
//      API page says it carries sessionId and shoppingPlatform in additionalData.
//   2. the Agentic Cart API session request Adyen posts to the merchant's
//      server, where shoppingPlatform is a required field.
//   3. the merchant's own /payments request on the UCP path, where the merchant
//      may write metadata.agentProtocol, agentSessionId and agentPlatform.
//
// In 1 and 2 Adyen names the platform. In 3 the merchant wrote it down.
//
// Field names read 2026-11-21 from
// https://docs.adyen.com/online-payments/agentic-commerce/merchant/agentic-cart-api-integration
// https://docs.adyen.com/online-payments/agentic-commerce/merchant/google-agentic-commerce
// The webhook wrapper (notificationItems, NotificationRequestItem) is Adyen's
// standard webhook shape, https://docs.adyen.com/development-resources/webhooks/webhook-types
//
// This code reads an object. It never calls Adyen.
import { looksLikePan } from './text.ts';
import { ReadRefused } from './braintree.ts';

export const ADYEN_SOURCES = [
  'https://docs.adyen.com/online-payments/agentic-commerce/merchant/agentic-cart-api-integration',
  'https://docs.adyen.com/online-payments/agentic-commerce/merchant/google-agentic-commerce',
  'https://docs.adyen.com/development-resources/webhooks/webhook-types',
];
export const ADYEN_READ_DATE = '2026-11-21';

export type AdyenSource = 'webhook' | 'cart_session_request' | 'payments_request';

export interface AdyenAgent {
  platform: string | null;
  session_id: string | null;
  protocol: string | null;
}

export interface AdyenOrderFacts {
  event_code: string | null;
  success: string | null;
  psp_reference: string | null;
  original_reference: string | null;
  merchant_reference: string | null;
  merchant_account: string | null;
  amount_value: string | null;
  currency: string | null;
  event_date: string | null;
}

export interface AdyenRead {
  gateway: 'adyen';
  source: AdyenSource;
  // adyen: the value sits on an object Adyen sent the merchant.
  // merchant: the value is one the merchant put on its own request.
  said_by: 'adyen' | 'merchant';
  marker: 'present' | 'absent';
  agent: AdyenAgent;
  // The keys the values were read from, as they are spelled on this object.
  matched_keys: string[];
  order: AdyenOrderFacts;
  keep: string[];
  warnings: string[];
  sources: string[];
  read_date: string;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
function text(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return String(v);
  return null;
}

// Dispute event codes listed on Adyen's webhook types page, read 2026-11-21.
const DISPUTE_EVENTS = new Set(['CHARGEBACK', 'CHARGEBACK_REVERSED', 'NOTIFICATION_OF_CHARGEBACK', 'INFORMATION_SUPPLIED', 'NOTIFICATION_OF_FRAUD', 'PREARBITRATION_LOST', 'PREARBITRATION_WON', 'PREARBITRATION_OPEN', 'PREARBITRATION_ACCEPTED', 'PREARBITRATION_DECLINED', 'PREARBITRATION_ISSUER_WITHDRAWN', 'SCHEME_ARBITRATION', 'REQUEST_FOR_INFORMATION', 'SECOND_CHARGEBACK', 'DISPUTE_DEFENSE_PERIOD_ENDED', 'ISSUER_RESPONSE_TIMEFRAME_EXPIRED', 'ISSUER_COMMENTS']);

// First hit wins. Adyen's page names the two keys in a sentence and prints no
// example payload, so both the flat and the "agentic." spellings are tried.
function fromAdditionalData(ad: Obj, name: 'shoppingPlatform' | 'sessionId'): { value: string | null; key: string | null } {
  const nested = isObj(ad.agentic) ? ad.agentic : null;
  const tries: Array<[string, unknown]> = [
    [name, ad[name]],
    ['agentic.' + name, ad['agentic.' + name]],
    ['agentic.' + name, nested ? nested[name] : undefined],
  ];
  for (const [key, v] of tries) { const t = text(v); if (t !== null) return { value: t, key: 'additionalData.' + key }; }
  return { value: null, key: null };
}

function unwrap(input: Obj, warnings: string[]): Obj {
  if (Array.isArray(input.notificationItems)) {
    const items = input.notificationItems.filter(isObj);
    if (items.length === 0) throw new ReadRefused('notificationItems is empty');
    if (items.length > 1) warnings.push('this webhook holds ' + items.length + ' items. Only the first was read. Pass the others one at a time.');
    const first = items[0];
    return isObj(first.NotificationRequestItem) ? first.NotificationRequestItem : first;
  }
  return isObj(input.NotificationRequestItem) ? input.NotificationRequestItem : input;
}

function kindOf(o: Obj): AdyenSource | null {
  if (typeof o.eventCode === 'string') return 'webhook';
  if ('shoppingPlatform' in o || Array.isArray(o.lineItems)) return 'cart_session_request';
  if (isObj(o.paymentMethod) || 'merchantAccount' in o || isObj(o.metadata)) return 'payments_request';
  return null;
}

export function readAdyenObject(input: unknown): AdyenRead {
  if (!isObj(input)) throw new ReadRefused('input must be an Adyen webhook, an Agentic Cart API session request or your own /payments request');
  const warnings: string[] = [];
  const o = unwrap(input, warnings);
  const source = kindOf(o);
  if (source === null) throw new ReadRefused('this does not look like an Adyen webhook item, a cart session request or a /payments request');

  const amount = isObj(o.amount) ? o.amount : {};
  const order: AdyenOrderFacts = {
    event_code: text(o.eventCode),
    success: text(o.success),
    psp_reference: text(o.pspReference),
    original_reference: text(o.originalReference),
    merchant_reference: text(o.merchantReference) ?? text(o.reference),
    merchant_account: text(o.merchantAccountCode) ?? text(o.merchantAccount),
    amount_value: text(amount.value),
    currency: text(amount.currency) ?? text(o.currency),
    event_date: text(o.eventDate),
  };

  const agent: AdyenAgent = { platform: null, session_id: null, protocol: null };
  const matched: string[] = [];
  let said_by: AdyenRead['said_by'] = 'adyen';
  const keep: string[] = [];

  if (source === 'webhook') {
    if (o.additionalData !== undefined && o.additionalData !== null && !isObj(o.additionalData)) throw new ReadRefused('additionalData is not an object');
    const ad = isObj(o.additionalData) ? o.additionalData : {};
    const p = fromAdditionalData(ad, 'shoppingPlatform');
    const s = fromAdditionalData(ad, 'sessionId');
    agent.platform = p.value; agent.session_id = s.value;
    for (const k of [p.key, s.key]) if (k) matched.push(k);
    if (order.psp_reference === null) warnings.push('no pspReference on this webhook item');
    if (order.success !== null && order.success.toLowerCase() !== 'true') warnings.push('success is "' + order.success + '", so this event did not go through.');
  } else if (source === 'cart_session_request') {
    agent.platform = text(o.shoppingPlatform);
    if (agent.platform !== null) matched.push('shoppingPlatform');
    warnings.push('The session id is in the URL path Adyen called (/agentic/sessions/{sessionId}), not in this body. Save it next to this request.');
  } else {
    said_by = 'merchant';
    if (o.metadata !== undefined && o.metadata !== null && !isObj(o.metadata)) throw new ReadRefused('metadata is not an object');
    const md = isObj(o.metadata) ? o.metadata : {};
    agent.platform = text(md.agentPlatform); agent.session_id = text(md.agentSessionId); agent.protocol = text(md.agentProtocol);
    for (const k of ['agentPlatform', 'agentSessionId', 'agentProtocol']) if (text(md[k]) !== null) matched.push('metadata.' + k);
  }

  // A session id alone says an agent session existed but not whose.
  const marker: AdyenRead['marker'] = agent.platform !== null || agent.session_id !== null || agent.protocol !== null ? 'present' : 'absent';
  const dispute = order.event_code !== null && DISPUTE_EVENTS.has(order.event_code);

  if (marker === 'present') {
    if (source === 'webhook') {
      keep.push('pspReference', ...matched, 'eventDate', 'amount', 'merchantReference');
      warnings.push('Adyen\'s Agentic Cart API page names sessionId and shoppingPlatform in additionalData in one sentence and prints no example webhook (read ' + ADYEN_READ_DATE + '). The key spelling here is what this object used.');
      if (order.event_code !== 'AUTHORISATION') warnings.push('Adyen documents these keys for the AUTHORISATION webhook. This item is ' + String(order.event_code) + '.');
    } else if (source === 'cart_session_request') {
      keep.push('shoppingPlatform', 'the sessionId from the URL path', 'reference', 'the time you received it');
    } else {
      keep.push(...matched, 'reference', 'the pspReference from the /payments response');
      warnings.push('These metadata values are ones you wrote on your own request. Adyen stores them and does not check them, and its page calls all three optional.');
    }
    if (agent.platform === null) warnings.push('No platform name on this object, so it does not say which agent placed the order.');
    warnings.push('Adyen\'s pages are silent on any agent field for disputes (scorecard, disputes cell). If this order is disputed, the marker comes from your saved copy of this object, matched on pspReference.');
  } else {
    if (source === 'webhook' && dispute) {
      warnings.push('This is a dispute event with no agent keys. Adyen\'s pages document none for dispute events. Match originalReference to the pspReference of the AUTHORISATION webhook you saved.');
    } else if (source === 'webhook') {
      warnings.push('No sessionId or shoppingPlatform in additionalData. That does not prove a person placed the order: Adyen documents the keys for the Agentic Cart API path only.');
    } else if (source === 'cart_session_request') {
      warnings.push('No shoppingPlatform on this request, though Adyen\'s page lists it as required.');
    } else {
      warnings.push('No agentPlatform, agentSessionId or agentProtocol in metadata. They are optional and only you can add them, so their absence says nothing about who ordered.');
    }
  }

  const out: AdyenRead = { gateway: 'adyen', source, said_by, marker, agent, matched_keys: matched, order, keep, warnings, sources: ADYEN_SOURCES, read_date: ADYEN_READ_DATE };
  // Same rule as the other readers: nothing that looks like a full card number leaves.
  for (const [name, value] of [...Object.entries(order), ...Object.entries(agent)] as Array<[string, unknown]>) {
    if (typeof value === 'string' && looksLikePan(value)) throw new ReadRefused('a value in ' + name + ' looks like a full card number');
  }
  return out;
}
