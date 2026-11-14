// Builds data/scorecard.json from the scorecard markdown.
// Usage: node scripts/build-scorecard.ts [path-to-scorecard.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLUMNS, parseScorecard } from '../src/scorecard.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2] ?? join(root, 'SCORECARD.md');
const card = parseScorecard(readFileSync(src, 'utf8'));
let cells = 0;
const bare: string[] = [];
for (const g of card.gateways) for (const c of COLUMNS) {
  cells++;
  const cell = g.cells[c];
  if ((cell.code === 'YES' || cell.code === 'PART') && cell.sources.length === 0) bare.push(g.id + '.' + c + ' (' + cell.code + ')');
}
// Cells whose quote is in the notes but whose page is named only in another
// paragraph of the same row. They need a re-read to pin the exact page.
writeFileSync(join(root, 'data', 'scorecard.json'), JSON.stringify({ ...card, source_gaps: bare.map((x) => x.split(' ')[0]) }, null, 2) + '\n');
console.log('gateways ' + card.gateways.length + ', cells ' + cells + ', read ' + card.read_date);
console.log('YES or PART cells with no source URL of their own: ' + bare.length);
for (const b of bare) console.log('  ' + b);
