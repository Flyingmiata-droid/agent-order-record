import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hashArtifact, verifyChain } from '../src/aep.ts';

const fx = (n: string) => JSON.parse(readFileSync(new URL('./fixtures/aep/' + n, import.meta.url), 'utf8'));

test('AEP vector b: all 8 hashes, links and signatures check out', () => {
  const b = fx('b-chain.json');
  assert.equal(b.artifacts.length, 8);
  for (const a of b.artifacts) {
    const h = hashArtifact(a.hash_input);
    assert.equal(h.canonical, a.canonical_json, 'canonical bytes, artifact ' + a.sequence_number);
    assert.equal(h.tagged, a.current_hash, 'hash, artifact ' + a.sequence_number);
  }
  const r = verifyChain(b.artifacts, b.ed25519_public_key_base64);
  assert.deepEqual(r, { hashChainIntact: true, signaturesValid: true, artifactsVerified: 8, errors: [] });
  assert.equal(fx('keys.json').public_key_base64, b.ed25519_public_key_base64);
});

test('a changed payload breaks the chain at that artifact', () => {
  const b = fx('b-chain.json');
  b.artifacts[5].hash_input.payload.total = 1;
  const r = verifyChain(b.artifacts, b.ed25519_public_key_base64);
  assert.equal(r.hashChainIntact, false);
  assert.equal(r.signaturesValid, false);
  assert.equal(r.artifactsVerified, 7);
  assert.match(r.errors.join(' '), /artifact 6 \(cart\)/);
});

test('a removed artifact breaks the previous_hash link', () => {
  const b = fx('b-chain.json');
  b.artifacts.splice(3, 1);
  const r = verifyChain(b.artifacts);
  assert.equal(r.hashChainIntact, false);
  assert.equal(r.signaturesValid, null);
});

test('a wrong key fails every signature but not the hashes', () => {
  const b = fx('b-chain.json');
  const r = verifyChain(b.artifacts, Buffer.alloc(32, 7).toString('base64'));
  assert.equal(r.hashChainIntact, true);
  assert.equal(r.signaturesValid, false);
});
