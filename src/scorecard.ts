// Gateway readiness scorecard as data. One row per gateway, seven cells per
// row, each cell with its code, the note beside it, the reading notes and the
// source pages it was read from.
export const COLUMNS = ['accepts', 'api_field', 'reporting', 'disputes', 'risk_rules', 'token_scope', 'refunds'] as const;
export type Column = (typeof COLUMNS)[number];
export const CODES = ['YES', 'PART', 'NO', 'SILENT', 'ASK', 'ANN'] as const;
export type Code = (typeof CODES)[number];

export interface Source { url: string; page_date?: string }
export interface Cell { code: Code; note: string; detail: string; sources: Source[] }
export interface Gateway { id: string; name: string; cells: Record<Column, Cell>; row_notes: string; row_sources: Source[] }
export interface Scorecard {
  title: string;
  read_date: string;
  built_from: string;
  codes: Record<Code, string>;
  columns: Record<Column, string>;
  gateways: Gateway[];
}

const HEADER_TO_COLUMN: Record<string, Column> = {
  'accepts agent orders': 'accepts', 'accepts': 'accepts',
  'agent field in api': 'api_field', 'api field': 'api_field',
  'shows in reporting': 'reporting', 'reporting': 'reporting',
  'reaches disputes': 'disputes', 'disputes': 'disputes',
  'risk rules read it': 'risk_rules', 'risk rules': 'risk_rules',
  'token scoped to merchant': 'token_scope', 'token scope': 'token_scope',
  'refund guidance': 'refunds', 'refunds': 'refunds',
};

export function extractSources(text: string): Source[] {
  const out: Source[] = [];
  const re = /https?:\/\/[^\s,;)"]+/g;
  for (const m of text.matchAll(re)) {
    const url = m[0].replace(/[.:]+$/, '');
    const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 60);
    const d = after.match(/^[.,]?\s*\((?:[a-z ]+)?(\d{4}-\d{2}-\d{2})/i);
    if (!out.some((s) => s.url === url)) out.push(d ? { url, page_date: d[1] } : { url });
  }
  return out;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// A row detail paragraph may open with one label ("Disputes: ...") or several
// ("Reporting, risk rules, token scope, refunds: silent."). Returns the
// columns it speaks for, or none when the paragraph has no label.
function labelColumns(par: string): Column[] {
  const i = par.indexOf(': ');
  const j = par.endsWith(':') ? par.length - 1 : -1;
  const end = i >= 0 ? i : j;
  if (end < 0 || end > 160) return [];
  const head = par.slice(0, end).replace(/\([^)]*\)/g, '').toLowerCase();
  const parts = head.split(',').map((s) => s.trim()).filter(Boolean);
  const cols: Column[] = [];
  for (const p of parts) {
    const c = HEADER_TO_COLUMN[p];
    if (!c) return [];
    cols.push(c);
  }
  return cols;
}

export function parseScorecard(md: string): Scorecard {
  const lines = md.split(/\r?\n/);
  const readDate = (md.match(/read (\d{4}-\d{2}-\d{2})/) ?? [])[1] ?? '';
  const tableStart = lines.findIndex((l) => l.startsWith('| Gateway |'));
  if (tableStart < 0) throw new Error('scorecard table not found');
  const header = lines[tableStart].split('|').slice(1, -1).map((s) => s.trim());
  const cols = header.slice(1).map((h) => {
    const c = HEADER_TO_COLUMN[h.toLowerCase()];
    if (!c) throw new Error('unknown column: ' + h);
    return c;
  });
  const columnTitles = {} as Record<Column, string>;
  cols.forEach((c, i) => { columnTitles[c] = header[i + 1]; });
  const gateways: Gateway[] = [];
  for (let i = tableStart + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const parts = lines[i].split('|').slice(1, -1).map((s) => s.trim());
    const cells = {} as Record<Column, Cell>;
    cols.forEach((c, k) => {
      const raw = parts[k + 1] ?? '';
      const code = raw.split(/\s+/)[0] as Code;
      if (!CODES.includes(code)) throw new Error('bad code "' + raw + '" for ' + parts[0]);
      cells[c] = { code, note: raw.slice(code.length).trim(), detail: '', sources: [] };
    });
    gateways.push({ id: slug(parts[0]), name: parts[0], cells, row_notes: '', row_sources: [] });
  }

  // Row detail sections come in the same order as the table rows.
  const sections: Array<{ title: string; body: string[] }> = [];
  let inDetail = false;
  for (const l of lines) {
    if (l.startsWith('## ')) { inDetail = l.trim() === '## Row detail'; continue; }
    if (!inDetail) continue;
    if (l.startsWith('### ')) sections.push({ title: l.slice(4).trim(), body: [] });
    else if (sections.length) sections[sections.length - 1].body.push(l);
  }
  if (sections.length !== gateways.length) throw new Error('row detail sections (' + sections.length + ') do not match table rows (' + gateways.length + ')');
  sections.forEach((s, idx) => {
    const g = gateways[idx];
    if (s.title.split(/[ (]/)[0].toLowerCase() !== g.name.split(/[ (]/)[0].toLowerCase()) throw new Error('row detail order mismatch: ' + s.title + ' vs ' + g.name);
    const pars = s.body.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean);
    const loose: string[] = [];
    for (const par of pars) {
      const lc = labelColumns(par);
      if (lc.length === 0) { loose.push(par); continue; }
      const src = extractSources(par);
      for (const c of lc) {
        g.cells[c].detail = g.cells[c].detail ? g.cells[c].detail + ' ' + par : par;
        for (const x of src) if (!g.cells[c].sources.some((y) => y.url === x.url)) g.cells[c].sources.push(x);
      }
    }
    g.row_notes = loose.join(' ');
    g.row_sources = extractSources(g.row_notes);
  });

  return {
    title: 'Gateway readiness scorecard, agent placed card orders',
    read_date: readDate,
    built_from: 'SCORECARD.md',
    codes: {
      YES: 'documented, field or sentence quoted', PART: 'documented in part', NO: 'doc says it does not',
      SILENT: 'relevant doc read, nothing on it', ASK: 'no relevant doc found or reachable', ANN: 'announced only, no live product or doc',
    },
    columns: columnTitles,
    gateways,
  };
}

// Every source URL with the cells that lean on it.
export function sourceIndex(card: Scorecard): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  const add = (url: string, where: string) => { const a = idx.get(url) ?? []; if (!a.includes(where)) a.push(where); idx.set(url, a); };
  for (const g of card.gateways) {
    for (const c of COLUMNS) for (const s of g.cells[c].sources) add(s.url, g.id + '.' + c);
    for (const s of g.row_sources) add(s.url, g.id + '.row');
  }
  return idx;
}
