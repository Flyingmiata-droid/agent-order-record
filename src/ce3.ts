// Visa Compelling Evidence 3.0 honest check for one disputed order.
// Says yes or no and why. It never pads a doomed response and never calls a gateway.
//
// Sources, and how sure each line is:
// - Element table (main: purchase IP, device ID or device fingerprint; secondary:
//   shipping address, email address, account ID), two priors, 120 to 364 days,
//   reason code 10.4, "fingerprint and device ID together is not a valid
//   combination": Stripe, docs.stripe.com/disputes/api/visa-ce3, read 2026-11-10.
// - Agentic payment provider (APP) login ID counts only as an additional element,
//   for disputes on or after 2026-10-24: Visa rules 18 April 2026, Table 11-28,
//   condition 10.4, as read 2026-10-24. Not re-read for this file.
// - Owner rule: a device or IP value counts as a main element only when it is the
//   cardholder's own. On an agent order the values often belong to the agent
//   platform. This is our reading of "cardholder" in the table; AEP issue 105
//   (2026-11-10) agreed rc.2 has no field for it yet. Unknown owner is not counted.
export type Owner = 'customer' | 'agent_platform' | 'unknown';

export interface Ce3Transaction {
  date: string; // ISO date or date-time
  customer_purchase_ip?: string;
  customer_device_id?: string;
  customer_device_fingerprint?: string;
  // Who the device and IP values above identify. Default unknown.
  device_ip_owner?: Owner;
  shipping_address?: string;
  customer_email_address?: string;
  customer_account_id?: string;
  app_login_id?: string;
}

export interface Ce3Prior extends Ce3Transaction {
  disputed?: boolean;
  validation_charge?: boolean;
  same_payment_method?: boolean; // default true
}

export interface Ce3Input {
  network: string; // 'visa'
  reason_code: string; // '10.4'
  dispute_date?: string; // decides whether the APP login ID element exists yet
  disputed: Ce3Transaction;
  priors: Ce3Prior[];
}

export type Element = 'ip' | 'device' | 'shipping_address' | 'email' | 'account_id' | 'app_login_id';
const MAIN: Element[] = ['ip', 'device'];

export interface Ce3Result {
  qualifies: boolean;
  reasons: string[]; // why not, or what carried it
  matched: Element[]; // elements that hold across the disputed order and the two priors used
  priors_used: number[]; // indexes into input.priors
  not_counted: string[]; // values present but not counted, with the reason
}

const APP_LOGIN_FROM = Date.UTC(2026, 9, 24);
const DAY = 86400000;
const norm = (s?: string) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const same = (a?: string, b?: string) => norm(a) !== '' && norm(a) === norm(b);
const day = (s: string) => { const t = Date.parse(s); if (Number.isNaN(t)) throw new Error('bad date: ' + s); return Math.floor(t / DAY); };

function matchedElements(d: Ce3Transaction, p: Ce3Prior, appLogin: boolean): Set<Element> {
  const m = new Set<Element>();
  const own = d.device_ip_owner === 'customer' && p.device_ip_owner === 'customer';
  if (own && same(d.customer_purchase_ip, p.customer_purchase_ip)) m.add('ip');
  // ID with ID or fingerprint with fingerprint. One device element at most.
  if (own && (same(d.customer_device_id, p.customer_device_id) || same(d.customer_device_fingerprint, p.customer_device_fingerprint))) m.add('device');
  if (same(d.shipping_address, p.shipping_address)) m.add('shipping_address');
  if (same(d.customer_email_address, p.customer_email_address)) m.add('email');
  if (same(d.customer_account_id, p.customer_account_id)) m.add('account_id');
  if (appLogin && same(d.app_login_id, p.app_login_id)) m.add('app_login_id');
  return m;
}

// Which kind of device value matched: Stripe's page says a device ID and a
// device fingerprint together are not a valid combination, so the same kind
// has to match on both priors.
function deviceKinds(d: Ce3Transaction, p: Ce3Prior): Set<'id' | 'fingerprint'> {
  const k = new Set<'id' | 'fingerprint'>();
  if (d.device_ip_owner !== 'customer' || p.device_ip_owner !== 'customer') return k;
  if (same(d.customer_device_id, p.customer_device_id)) k.add('id');
  if (same(d.customer_device_fingerprint, p.customer_device_fingerprint)) k.add('fingerprint');
  return k;
}

const enough = (els: Element[]) => els.length >= 2 && els.some((e) => MAIN.includes(e));

export function checkCe3(input: Ce3Input): Ce3Result {
  const out: Ce3Result = { qualifies: false, reasons: [], matched: [], priors_used: [], not_counted: [] };
  if (norm(input.network) !== 'visa') { out.reasons.push('not a Visa dispute'); return out; }
  if (input.reason_code.trim() !== '10.4') { out.reasons.push('reason code is ' + input.reason_code + ', CE 3.0 covers 10.4 only'); return out; }
  const d = input.disputed;
  const appLogin = input.dispute_date !== undefined && Date.parse(input.dispute_date) >= APP_LOGIN_FROM;
  const owner = d.device_ip_owner ?? 'unknown';
  const hasDevIp = !!(d.customer_purchase_ip || d.customer_device_id || d.customer_device_fingerprint);
  if (hasDevIp && owner !== 'customer') out.not_counted.push('device and IP values on the disputed order: owner is ' + owner + ', not the cardholder');
  if (d.app_login_id && !appLogin) out.not_counted.push('APP login ID: dispute date missing or before 2026-10-24');

  const dDay = day(d.date);
  const eligible: Array<{ i: number; m: Set<Element>; dev: Set<'id' | 'fingerprint'> }> = [];
  input.priors.forEach((p, i) => {
    if (p.disputed || p.validation_charge || p.same_payment_method === false) return;
    const age = dDay - day(p.date);
    if (age < 120 || age > 364) return;
    const dd = { ...d, device_ip_owner: owner }; const pp = { ...p, device_ip_owner: p.device_ip_owner ?? 'unknown' };
    eligible.push({ i, m: matchedElements(dd, pp, appLogin), dev: deviceKinds(dd, pp) });
  });
  if (eligible.length < 2) {
    out.reasons.push('needs 2 undisputed prior orders on the same payment method, 120 to 364 days before the disputed order; found ' + eligible.length);
    return out;
  }
  // Pick the pair of priors whose shared matches are widest.
  let best: { a: number; b: number; els: Element[] } | undefined;
  for (let x = 0; x < eligible.length; x++) for (let y = x + 1; y < eligible.length; y++) {
    const sameKind = [...eligible[x].dev].some((k) => eligible[y].dev.has(k));
    const els = [...eligible[x].m].filter((e) => eligible[y].m.has(e) && (e !== 'device' || sameKind));
    const better = !best || (enough(els) && !enough(best.els)) || (enough(els) === enough(best.els) && els.length > best.els.length);
    if (better) best = { a: eligible[x].i, b: eligible[y].i, els };
  }
  out.matched = best!.els; out.priors_used = [best!.a, best!.b];
  if (enough(best!.els)) { out.qualifies = true; out.reasons.push('matched across both priors: ' + best!.els.join(', ')); return out; }
  if (!best!.els.some((e) => MAIN.includes(e))) {
    out.reasons.push(owner !== 'customer' && hasDevIp
      ? 'no main element: the device and IP on this order are not the cardholder\'s, and secondary elements (' + (best!.els.join(', ') || 'none') + ') cannot qualify alone'
      : 'no main element (cardholder IP, device ID or device fingerprint) matches both priors');
  } else out.reasons.push('one main element matched (' + best!.els.join(', ') + ') but no second element');
  return out;
}
