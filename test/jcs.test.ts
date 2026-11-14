import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonicalize, sha256Tagged } from '../src/jcs.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/aep/' + n, import.meta.url), 'utf8'));

test('AEP vector h: canonicalization cases', () => {
  const h = fx('h-canonicalization.json');
  assert.equal(h.cases.length, 5);
  for (const c of h.cases) {
    for (const input of c.inputs) {
      const canon = canonicalize(input);
      assert.equal(canon, c.expected_canonical, c.name);
      assert.equal(sha256Tagged(canon), c.expected_sha256, c.name);
    }
  }
});

test('AEP vector a: genesis bytes and hash, the conformance gate', () => {
  const a = fx('a-genesis.json');
  const canon = canonicalize(a.hash_input);
  assert.equal(canon, a.canonical_json);
  assert.equal(Buffer.byteLength(canon, 'utf8'), a.canonical_utf8_length_bytes);
  assert.equal(sha256Tagged(canon), a.expected_sha256);
});

test('canonicalize rejects what JCS cannot carry', () => {
  assert.throws(() => canonicalize({ n: Infinity }));
  assert.throws(() => canonicalize({ 'e\u0301': 1, '\u00e9': 2 }), /duplicate/);
});
