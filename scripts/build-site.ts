// Writes the scorecard site into docs/. Run: npm run build:site
// Set SITE_BASE to build for another address (it must end with a slash).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite, DEFAULT_BASE } from '../src/site.ts';

const root = new URL('../', import.meta.url);
const raw = readFileSync(new URL('data/scorecard.json', root), 'utf8').replace(/\r\n/g, '\n');
const snaps = JSON.parse(readFileSync(new URL('data/snapshots.json', root), 'utf8'));
const base = process.env.SITE_BASE ?? DEFAULT_BASE;
if (!base.endsWith('/')) throw new Error('SITE_BASE must end with a slash');
const files = buildSite(JSON.parse(raw), snaps, raw, base);
for (const [path, text] of Object.entries(files)) {
  const out = fileURLToPath(new URL('docs/' + path, root));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
}
console.log('site: ' + Object.keys(files).length + ' files in docs/, base ' + base);
