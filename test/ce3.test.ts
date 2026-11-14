import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCe3 } from '../src/ce3.ts';
import type { Ce3Input, Ce3Prior, Ce3Transaction } from '../src/ce3.ts';

const base: Ce3Transaction = { date: '2026-11-01', customer_purchase_ip: '203.0.113.7', customer_device_id: 'dev-1', device_ip_owner: 'customer', customer_email_address: 'A@Example.com', customer_account_id: 'acct-9' };
const prior = (date: string, over: Partial<Ce3Prior> = {}): Ce3Prior => ({ ...base, date, ...over });
const input = (over: Partial<Ce3Input> = {}): Ce3Input => ({ network: 'visa', reason_code: '10.4', dispute_date: '2026-11-05', disputed: base, priors: [prior('2026-05-01'), prior('2026-03-01')], ...over });

test('human order, two main elements: yes', () => {
  const r = checkCe3(input());
  assert.equal(r.qualifies, true);
  assert.ok(r.matched.includes('ip') && r.matched.includes('device'));
});

test('one main plus one secondary: yes', () => {
  const d = { ...base, customer_device_id: undefined, customer_account_id: undefined };
  const r = checkCe3(input({ disputed: d, priors: [prior('2026-05-01', { customer_purchase_ip: '203.0.113.7' }), prior('2026-03-01')] }));
  assert.equal(r.qualifies, true);
  assert.deepEqual(r.matched.sort(), ['email', 'ip']);
});

test('agent order: platform IP and device do not count, login ID cannot carry it', () => {
  const d: Ce3Transaction = { ...base, device_ip_owner: 'agent_platform', app_login_id: 'app-user-1' };
  const ps = [prior('2026-05-01', { device_ip_owner: 'agent_platform', app_login_id: 'app-user-1' }), prior('2026-03-01', { device_ip_owner: 'agent_platform', app_login_id: 'app-user-1' })];
  const r = checkCe3(input({ disputed: d, priors: ps }));
  assert.equal(r.qualifies, false);
  assert.ok(r.matched.includes('app_login_id'));
  assert.ok(!r.matched.includes('ip') && !r.matched.includes('device'));
  assert.match(r.reasons[0], /no main element/);
  assert.equal(r.not_counted.length, 1);
});

test('unknown owner is treated like not the cardholder', () => {
  const d = { ...base, device_ip_owner: undefined };
  assert.equal(checkCe3(input({ disputed: d })).qualifies, false);
});

test('cardholder device plus APP login ID: yes on or after 2026-10-24, login ID ignored before', () => {
  const strip = { customer_purchase_ip: undefined, customer_email_address: undefined, customer_account_id: undefined, app_login_id: 'app-user-1' };
  const d = { ...base, ...strip };
  const ps = [prior('2026-05-01', strip), prior('2026-03-01', strip)];
  assert.equal(checkCe3(input({ disputed: d, priors: ps })).qualifies, true);
  const before = checkCe3(input({ disputed: { ...d, date: '2026-10-01' }, priors: ps, dispute_date: '2026-10-20' }));
  assert.equal(before.qualifies, false);
  assert.match(before.reasons[0], /no second element/);
});

test('fingerprint does not match a device ID, and both together are one element', () => {
  const d = { ...base, customer_purchase_ip: undefined, customer_email_address: undefined, customer_account_id: undefined, customer_device_fingerprint: 'fp-1' };
  const ps = [prior('2026-05-01', { customer_device_fingerprint: 'fp-1' }), prior('2026-03-01', { customer_device_fingerprint: 'fp-1' })].map((p) => ({ ...p, customer_purchase_ip: undefined, customer_email_address: undefined, customer_account_id: undefined }));
  const r = checkCe3(input({ disputed: d, priors: ps }));
  assert.deepEqual(r.matched, ['device']);
  assert.equal(r.qualifies, false);
});

test('window and prior rules', () => {
  // 119 days and 365 days are out; disputed, validation and other-card priors are out.
  const ps = [prior('2026-07-05'), prior('2025-11-01'), prior('2026-05-01', { disputed: true }), prior('2026-04-01', { validation_charge: true }), prior('2026-03-01', { same_payment_method: false })];
  const r = checkCe3(input({ priors: ps }));
  assert.equal(r.qualifies, false);
  assert.match(r.reasons[0], /found 0/);
  // 120 and 364 days are in.
  assert.equal(checkCe3(input({ priors: [prior('2026-07-04'), prior('2025-11-02')] })).qualifies, true);
});

test('wrong network or reason code: no', () => {
  assert.equal(checkCe3(input({ network: 'mastercard' })).qualifies, false);
  assert.equal(checkCe3(input({ reason_code: '13.1' })).qualifies, false);
});

test('picks the best pair out of three priors', () => {
  const weak = prior('2026-06-01', { customer_purchase_ip: '198.51.100.1', customer_device_id: 'other', customer_account_id: 'x', customer_email_address: 'z@example.com' });
  const r = checkCe3(input({ priors: [weak, prior('2026-05-01'), prior('2026-03-01')] }));
  assert.equal(r.qualifies, true);
  assert.deepEqual(r.priors_used, [1, 2]);
});

test('device ID on one prior and fingerprint on the other is not one device element', () => {
  const d: Ce3Transaction = { date: '2026-11-01', customer_device_id: 'dev-1', customer_device_fingerprint: 'fp-1', device_ip_owner: 'customer', customer_email_address: 'a@example.com' };
  const ps = [
    prior('2026-05-01', { customer_purchase_ip: undefined, customer_account_id: undefined, customer_device_id: 'dev-1', customer_device_fingerprint: 'other' }),
    prior('2026-03-01', { customer_purchase_ip: undefined, customer_account_id: undefined, customer_device_id: 'other', customer_device_fingerprint: 'fp-1' }),
  ];
  const r = checkCe3(input({ disputed: d, priors: ps }));
  assert.equal(r.qualifies, false);
  assert.ok(!r.matched.includes('device'));
});
