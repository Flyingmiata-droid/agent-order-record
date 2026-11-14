// JSON canonicalization as AEP 4.1 pins it: RFC 8785 (JCS) plus NFC
// normalization of member names and string values. Member names sort by
// UTF-16 code unit at every level. Arrays keep their order.
import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value.normalize('NFC'));
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  if (typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const pairs: Array<[string, unknown]> = [];
    for (const k of Object.keys(src)) {
      if (src[k] === undefined) continue;
      pairs.push([k.normalize('NFC'), src[k]]);
    }
    // Default string comparison in JS is by UTF-16 code unit, which is the JCS rule.
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (let i = 1; i < pairs.length; i++) {
      if (pairs[i][0] === pairs[i - 1][0]) throw new Error('canonicalize: duplicate member name after NFC: ' + pairs[i][0]);
    }
    return '{' + pairs.map(([k, v]) => JSON.stringify(k) + ':' + canonicalize(v)).join(',') + '}';
  }
  throw new Error('canonicalize: unsupported type ' + typeof value);
}

export function sha256Digest(canonical: string): Buffer {
  return createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest();
}

export function sha256Tagged(canonical: string): string {
  return 'sha256:' + sha256Digest(canonical).toString('hex');
}
