// Usage: node scripts/recheck.ts            compare against data/snapshots.json and report
//        node scripts/recheck.ts --write    also save the new snapshots
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Scorecard } from '../src/scorecard.ts';
import { sourceIndex } from '../src/scorecard.ts';
import type { Snapshots } from '../src/recheck.ts';
import { recheck } from '../src/recheck.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const card = JSON.parse(readFileSync(join(root, 'data', 'scorecard.json'), 'utf8')) as Scorecard;
const snapPath = join(root, 'data', 'snapshots.json');
const prior: Snapshots = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, 'utf8')) : {};
const idx = sourceIndex(card);
const fetcher = async (url: string) => {
  const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'agent-order-record scorecard recheck' } });
  return { status: r.status, text: await r.text() };
};
const today = new Date().toISOString().slice(0, 10);
const out = await recheck([...idx.keys()], prior, fetcher, today);
console.log('pages ' + idx.size + ': same ' + out.same.length + ', new ' + out.fresh.length + ', changed ' + out.changed.length + ', unreachable ' + out.unreachable.length);
for (const u of out.changed) console.log('CHANGED ' + u + '\n   re-read cells: ' + (idx.get(u) ?? []).join(', '));
for (const u of out.unreachable) console.log('UNREACHABLE ' + u + ' (http ' + (out.snapshots[u].http ?? 'none') + ')');
if (process.argv.includes('--write')) { writeFileSync(snapPath, JSON.stringify(out.snapshots, null, 2) + '\n'); console.log('snapshots saved'); }
