import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODES, COLUMNS, extractSources, parseScorecard, sourceIndex } from '../src/scorecard.ts';
import type { Scorecard } from '../src/scorecard.ts';
import { normalizePage, pageHash, recheck } from '../src/recheck.ts';

const card = JSON.parse(readFileSync(new URL('../data/scorecard.json', import.meta.url), 'utf8')) as Scorecard & { source_gaps: string[] };

test('scorecard data: 16 gateways, 7 coded cells each', () => {
  assert.equal(card.gateways.length, 16);
  assert.equal(new Set(card.gateways.map((g) => g.id)).size, 16);
  for (const g of card.gateways) for (const c of COLUMNS) {
    assert.ok(CODES.includes(g.cells[c].code), g.id + '.' + c);
    for (const s of g.cells[c].sources) assert.match(s.url, /^https:\/\//);
  }
  assert.equal(card.read_date, '2026-10-15');
});

test('the headline finding holds in the data: no gateway documents the agent signal on a dispute', () => {
  assert.equal(card.gateways.filter((g) => g.cells.disputes.code === 'YES').length, 0);
  assert.deepEqual(card.gateways.filter((g) => g.cells.api_field.code === 'YES').map((g) => g.id), ['stripe', 'braintree']);
});

test('every YES or PART cell has a source page or is a listed gap', () => {
  const bare: string[] = [];
  for (const g of card.gateways) for (const c of COLUMNS) {
    const cell = g.cells[c];
    if ((cell.code === 'YES' || cell.code === 'PART') && cell.sources.length === 0) bare.push(g.id + '.' + c);
  }
  assert.deepEqual(bare, card.source_gaps);
  assert.ok(card.source_gaps.length <= 7, 'source gaps must shrink, never grow');
});

test('parser reads codes, joint labels, sources and page dates', () => {
  const md = ['Draft, read 2026-10-15.', '| Gateway | Accepts agent orders | Agent field in API | Shows in reporting | Reaches disputes | Risk rules read it | Token scoped to merchant | Refund guidance |', '|---|---|---|---|---|---|---|---|', '| Acme (Test) | YES (live) | PART request side | SILENT | SILENT | SILENT | NO | ASK |', '', '## Row detail', '', '### Acme (Test)', '', 'Accepts: live, https://acme.example/agents (2026-06-16).', '', 'API field: request side only, https://acme.example/api (modified 2025-12-23), https://acme.example/ref.', '', 'Reporting, risk rules (custom only), refunds: silent.', '', 'A loose note with https://acme.example/blog.', '', '## Limits', '', 'Text here is ignored, https://acme.example/ignored.'].join('\n');
  const c = parseScorecard(md);
  const g = c.gateways[0];
  assert.equal(g.id, 'acme');
  assert.equal(g.cells.accepts.code, 'YES');
  assert.equal(g.cells.accepts.note, '(live)');
  assert.deepEqual(g.cells.accepts.sources, [{ url: 'https://acme.example/agents', page_date: '2026-06-16' }]);
  assert.deepEqual(g.cells.api_field.sources, [{ url: 'https://acme.example/api', page_date: '2025-12-23' }, { url: 'https://acme.example/ref' }]);
  assert.match(g.cells.risk_rules.detail, /silent/);
  assert.equal(g.cells.disputes.detail, '');
  assert.deepEqual(g.row_sources, [{ url: 'https://acme.example/blog' }]);
  assert.deepEqual([...sourceIndex(c).keys()].sort(), ['https://acme.example/agents', 'https://acme.example/api', 'https://acme.example/blog', 'https://acme.example/ref']);
  assert.deepEqual(extractSources('see https://a.example/x.'), [{ url: 'https://a.example/x' }]);
});

test('recheck flags a changed page, ignores markup noise, and never calls an unreachable page changed', async () => {
  const body = (words: string, build: string) => '<html><head><script>var build="' + build + '"</script></head><body><p>' + words + ' ' + 'filler '.repeat(60) + '</p></body></html>';
  assert.equal(pageHash(body('agent_details is documented', 'a1')), pageHash(body('agent_details   is documented', 'b2')));
  assert.equal(normalizePage('<p>a</p><!-- x --><style>p{}</style> b'), 'a b');
  const pages: Record<string, { status: number; text: string }> = {
    'https://x.example/same': { status: 200, text: body('nothing new', 'a') },
    'https://x.example/moved': { status: 200, text: body('old words', 'a') },
    'https://x.example/down': { status: 200, text: body('fine', 'a') },
  };
  const fetcher = async (u: string) => { const p = pages[u]; if (!p) throw new Error('no route'); return p; };
  const urls = Object.keys(pages);
  const first = await recheck(urls, {}, fetcher, '2026-11-09');
  assert.equal(first.fresh.length, 3);
  pages['https://x.example/same'].text = body('nothing new', 'zzz');
  pages['https://x.example/moved'].text = body('new words: agent field added to disputes', 'a');
  pages['https://x.example/down'] = { status: 503, text: 'error' };
  const second = await recheck(urls, first.snapshots, fetcher, '2026-12-09');
  assert.deepEqual(second.changed, ['https://x.example/moved']);
  assert.deepEqual(second.same, ['https://x.example/same']);
  assert.deepEqual(second.unreachable, ['https://x.example/down']);
  assert.equal(second.snapshots['https://x.example/down'].hash, first.snapshots['https://x.example/down'].hash);
  assert.equal(second.snapshots['https://x.example/moved'].last_changed, '2026-12-09');
});
