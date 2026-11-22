// The scorecard as a static site: one index page and one page per gateway,
// built from data/scorecard.json and data/snapshots.json. No dependencies.
// Every number on a page is counted from the data here, never typed.
import { CODES, COLUMNS } from './scorecard.ts';
import type { Code, Column, Gateway, Scorecard, Source } from './scorecard.ts';
import type { Snapshots } from './recheck.ts';

export const SITE_NAME = 'Agent Order Record';
export const DEFAULT_BASE = 'https://flyingmiata-droid.github.io/agent-order-record/';
export const REPO = 'https://github.com/Flyingmiata-droid/agent-order-record';
const FONT_CSS = 'https://fonts.bunny.net/css?family=ibm-plex-sans:400,500,700&display=swap';
// Cloudflare Web Analytics site token. It is public by design: it only says
// which dashboard a page view lands in. Empty string builds with no counter.
export const CF_BEACON_TOKEN = '6f67725923f54e26ac8c66e6e6053de7';
export const CONTACT = 'nick@kaufmanops.com';
export const LEGAL_UPDATED = '2026-11-21';

// The few sentences that are not data. The question and the method lines are
// the ones SCORECARD.md already carries.
export const COPY = {
  question: 'When an AI agent places a card order through a gateway, what does the merchant get back that says so, and does that signal reach the dispute?',
  method: "Every cell is read from the vendor's own docs, API reference, changelog, terms or press release. Nothing is inferred from a marketing sentence.",
  stale: 'Vendor pages change. Open the source link before you lean on a cell.',
  keeper: 'Kept by Nick Kaufman. The data and the code are open under Apache-2.0.',
  fix: 'Found a wrong cell? Open an issue with the page that says so.',
  who: 'For payment leads at software platforms and payfacs who need to know what their gateway hands back.',
  scope: 'Card orders only, read from public docs. A field a vendor has not documented will not show here.',
  apart: 'Not affiliated with any company named here. Their names belong to them. This is a reading of public docs, not legal or compliance advice.',
};

// Privacy and terms. Plain pages, same shell. Each paragraph is one string;
// a string that starts with "## " is a heading.
export const PRIVACY: string[] = [
  'This site is run by Nick Kaufman. Write to ' + 'nick@kaufmanops.com' + ' about anything on this page.',
  '## What the site collects',
  'No names, no emails, no accounts. It has no forms and no ad pixels, and it sets no cookies. Page views are counted, and that is all.',
  '## Who else sees your visit',
  'Three companies, because your browser asks them for files. GitHub hosts the site and logs visitor IP addresses for security: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages. Bunny Fonts serves the typeface and says it keeps no logs: https://bunny.net/fonts. Cloudflare Web Analytics counts page views; Cloudflare says it uses no cookies or local storage and does not fingerprint visitors: https://www.cloudflare.com/web-analytics/.',
  'A link to a vendor page or to GitHub leaves this site. Those sites run on their own rules.',
  '## Selling and sharing',
  'Nothing is sold, and nothing is shared for ads. If your browser sends a Global Privacy Control signal, there is no sale or ad sharing here for it to switch off.',
  '## If you write to me',
  'I keep your email until the matter is closed and delete it when you ask. Beyond that I see page view counts, not people, so there is nothing about you for me to send or delete. For what GitHub or Cloudflare holds about a visit, ask them.',
];
export const TERMS: string[] = [
  'This site is a reading of public vendor documentation on the dates shown, kept by Nick Kaufman.',
  '## No warranty',
  'Vendor pages change, and a cell can be out of date or wrong. Open the source link before you rely on a cell. Nothing here is legal, compliance or financial advice.',
  '## Reuse',
  'The data and the code are open under Apache-2.0. The license text governs reuse: https://github.com/Flyingmiata-droid/agent-order-record/blob/main/LICENSE.',
  '## Names',
  'Vendor and product names belong to their owners. This site is not affiliated with, sponsored by or endorsed by any company named on it.',
  '## Corrections',
  'Open an issue or write to ' + 'nick@kaufmanops.com' + ' with the page that shows the cell is wrong.',
  '## Liability and law',
  'To the extent the law allows, Nick Kaufman is not liable for loss that comes from using this site. Texas law governs these terms.',
  'These terms can change. The date on this page shows the last change.',
];

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Escapes the text and turns each URL in it into a link. The URL rule is the
// one extractSources uses, so a link here is a source there.
export function linkify(text: string): string {
  const re = /https?:\/\/[^\s,;)"]+/g;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const url = raw.replace(/[.:]+$/, '');
    const at = m.index ?? 0;
    out += esc(text.slice(last, at)) + '<a href="' + esc(url) + '" rel="noopener">' + esc(url) + '</a>' + esc(raw.slice(url.length));
    last = at + raw.length;
  }
  return out + esc(text.slice(last));
}

export function countCodes(card: Scorecard, col: Column): Record<Code, number> {
  const n = {} as Record<Code, number>;
  for (const c of CODES) n[c] = 0;
  for (const g of card.gateways) n[g.cells[col].code]++;
  return n;
}

export function gatewaySources(g: Gateway): string[] {
  const urls: string[] = [];
  const add = (s: Source) => { if (!urls.includes(s.url)) urls.push(s.url); };
  for (const c of COLUMNS) g.cells[c].sources.forEach(add);
  g.row_sources.forEach(add);
  return urls;
}

function plural(n: number, one: string, many: string): string { return n + ' ' + (n === 1 ? one : many); }

export function gatewayPath(g: Gateway): string { return 'gateways/' + g.id + '/'; }

function chip(code: Code): string {
  return '<span class="chip chip-' + code.toLowerCase() + '">' + code + '</span>';
}

function sourceLine(s: Source, snaps: Snapshots): string {
  const bits: string[] = [];
  if (s.page_date) bits.push('page dated ' + esc(s.page_date));
  const snap = snaps[s.url];
  if (snap && snap.status === 'ok') bits.push('fetched ' + esc(snap.last_checked));
  if (snap && snap.status === 'unreachable') bits.push('could not be fetched by script on ' + esc(snap.last_checked));
  return '<li><a href="' + esc(s.url) + '" rel="noopener">' + esc(s.url) + '</a>' + (bits.length ? ' <span class="meta">(' + bits.join(', ') + ')</span>' : '') + '</li>';
}

function latestCheck(snaps: Snapshots): string {
  let d = '';
  for (const k of Object.keys(snaps)) if (snaps[k].last_checked > d) d = snaps[k].last_checked;
  return d;
}

function fitTitle(main: string): string {
  const full = main + ' | ' + SITE_NAME;
  return full.length <= 70 ? full : main;
}

function page(o: { base: string; path: string; title: string; description: string; body: string; jsonld?: unknown; depth: number; noindex?: boolean; abs?: boolean }): string {
  const up = '../'.repeat(o.depth);
  const canonical = o.base + o.path;
  const ld = o.jsonld ? '\n<script type="application/ld+json">' + JSON.stringify(o.jsonld).replace(/</g, '\\u003c') + '</script>' : '';
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>' + esc(o.title) + '</title>\n<meta name="description" content="' + esc(o.description) + '">\n' +
    (o.noindex ? '<meta name="robots" content="noindex">\n' : '<link rel="canonical" href="' + esc(canonical) + '">\n') +
    '<meta property="og:type" content="website">\n<meta property="og:site_name" content="' + SITE_NAME + '">\n<meta property="og:title" content="' + esc(o.title) + '">\n<meta property="og:description" content="' + esc(o.description) + '">\n<meta property="og:url" content="' + esc(canonical) + '">\n<meta property="og:image" content="' + esc(o.base) + 'og.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta property="og:image:alt" content="' + SITE_NAME + ': gateway readiness scorecard, agent placed card orders">\n<meta name="twitter:card" content="summary_large_image">\n' +
    '<link rel="icon" href="' + up + 'favicon.ico" sizes="any">\n<link rel="icon" href="' + up + 'favicon.svg" type="image/svg+xml">\n<link rel="icon" type="image/png" sizes="32x32" href="' + up + 'favicon-32.png">\n<link rel="apple-touch-icon" href="' + up + 'apple-touch-icon.png">\n<link rel="preconnect" href="https://fonts.bunny.net">\n<link rel="stylesheet" href="' + FONT_CSS + '">\n<link rel="stylesheet" href="' + up + 'style.css">' + ld + '\n</head>\n<body>\n<a class="skip" href="#main">Skip to content</a>\n<header class="top"><a class="brand" href="' + (up || './') + '">' + SITE_NAME + '</a><nav aria-label="Site"><a href="' + (up || './') + '#card">The card</a><a href="' + (up || './') + '#codes">Cell codes</a><a href="' + REPO + '">GitHub</a></nav></header>\n<main id="main">\n' + o.body + '\n</main>\n<footer class="foot"><p>' + esc(COPY.keeper) + ' ' + esc(COPY.fix) + ' <a href="' + REPO + '/issues">Open an issue</a></p><p>' + esc(COPY.apart) + '</p><p><a href="' + (o.abs ? o.base : up) + 'privacy/">Privacy</a> <a href="' + (o.abs ? o.base : up) + 'terms/">Terms</a></p></footer>\n' + (CF_BEACON_TOKEN ? '<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token": "' + CF_BEACON_TOKEN + '"}\'></script>\n' : '') + '</body>\n</html>\n';
}

// Stacked bars, one per column, counted from the data. The caption and the
// table under it carry every number, so nothing rides on color.
const BAR_ORDER: Code[] = ['YES', 'PART', 'ANN', 'NO', 'SILENT', 'ASK'];
export function figure(card: Scorecard): string {
  const total = card.gateways.length;
  const W = 720, LEFT = 210, BAR = 26, GAP = 14, usable = W - LEFT - 10;
  const H = COLUMNS.length * (BAR + GAP) + 6;
  let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-labelledby="figt" class="bars"><title id="figt">Cell codes per column across ' + total + ' gateways</title>';
  COLUMNS.forEach((col, i) => {
    const y = i * (BAR + GAP) + 4;
    const n = countCodes(card, col);
    svg += '<text x="' + (LEFT - 12) + '" y="' + (y + 18) + '" text-anchor="end" class="lbl">' + esc(card.columns[col]) + '</text>';
    let x = LEFT;
    for (const code of BAR_ORDER) {
      if (!n[code]) continue;
      const w = Math.round((n[code] / total) * usable * 100) / 100;
      svg += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + BAR + '" class="seg seg-' + code.toLowerCase() + '"/>';
      if (w >= 52) svg += '<text x="' + (x + 6) + '" y="' + (y + 18) + '" class="segt segt-' + code.toLowerCase() + '">' + code + ' ' + n[code] + '</text>';
      else if (w >= 16) svg += '<text x="' + (x + 5) + '" y="' + (y + 18) + '" class="segt segt-' + code.toLowerCase() + '">' + n[code] + '</text>';
      x = Math.round((x + w) * 100) / 100;
    }
  });
  svg += '</svg>';
  const yes = (c: Column) => countCodes(card, c).YES;
  const caption = 'Documented YES, out of ' + total + ' gateways: ' + yes('accepts') + ' accept agent orders, ' + yes('api_field') + ' name an agent field in the API, ' + yes('reporting') + ' show it in reporting, ' + yes('disputes') + ' carry it to the dispute.';
  let table = '<details class="alt"><summary>The same counts as a table</summary><div class="scroll"><table class="counts"><thead><tr><th scope="col">Column</th>' + CODES.map((c) => '<th scope="col">' + c + '</th>').join('') + '</tr></thead><tbody>';
  for (const col of COLUMNS) {
    const n = countCodes(card, col);
    table += '<tr><th scope="row">' + esc(card.columns[col]) + '</th>' + CODES.map((c) => '<td>' + n[c] + '</td>').join('') + '</tr>';
  }
  table += '</tbody></table></div></details>';
  return '<figure class="fig"><div class="figscroll" tabindex="0" role="region" aria-label="Bar chart of cell codes">' + svg + '</div><figcaption>' + esc(caption) + '</figcaption>' + table + '</figure>';
}

export function indexPage(card: Scorecard, snaps: Snapshots, base: string): string {
  const total = card.gateways.length;
  const d = countCodes(card, 'disputes');
  const lede = total + ' gateways read against their own docs. ' + d.YES + (d.YES === 1 ? ' is' : ' are') + ' a documented YES on the agent signal reaching the dispute.';
  const split = 'On that column: ' + CODES.filter((c) => d[c] > 0).map((c) => d[c] + ' ' + c).join(', ') + '.';
  const desc = lede + ' One row per gateway, ' + COLUMNS.length + ' cells a row, each with its source page.';
  let rows = '';
  for (const g of card.gateways) {
    rows += '<tr><th scope="row"><a href="' + gatewayPath(g) + '">' + esc(g.name) + '</a></th>' + COLUMNS.map((c) => {
      const cell = g.cells[c];
      return '<td>' + chip(cell.code) + (cell.note ? ' <span class="note">' + esc(cell.note) + '</span>' : '') + '</td>';
    }).join('') + '</tr>';
  }
  const codes = CODES.map((c) => '<div class="code"><dt>' + chip(c) + '</dt><dd>' + esc(card.codes[c]) + '</dd></div>').join('');
  const last = latestCheck(snaps);
  const body =
    '<section class="hero"><h1>' + esc(card.title) + '</h1><p class="lede">' + esc(lede) + '</p><p class="q">' + esc(COPY.question) + '</p><p class="q">' + esc(COPY.who) + ' ' + esc(COPY.scope) + '</p></section>\n' +
    '<section class="finding"><h2>' + (d.YES === 0 ? 'No gateway is a documented YES on the agent signal reaching a dispute' : 'Where the agent signal reaches the dispute') + '</h2><p class="meta">' + esc(split) + ' <a href="#codes">What the codes mean</a></p>' + figure(card) + '</section>\n' +
    '<section id="card"><h2>The card</h2><p class="meta">First read ' + esc(card.read_date) + '.' + (last ? ' Source pages last fetched by script ' + esc(last) + '.' : '') + ' Pick a gateway for the reading notes and the source pages.</p><div class="scroll" tabindex="0" role="region" aria-label="Scorecard table"><table class="card"><thead><tr><th scope="col">Gateway</th>' + COLUMNS.map((c) => '<th scope="col">' + esc(card.columns[c]) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></section>\n' +
    '<section id="codes"><h2>Cell codes</h2><dl class="codes">' + codes + '</dl></section>\n' +
    '<section id="method"><h2>How a cell gets its code</h2><p>' + esc(COPY.method) + '</p><p>' + esc(COPY.stale) + '</p><p><a class="cta" href="' + REPO + '/issues">Report a wrong cell</a> <a class="plain" href="data/scorecard.json">Download the data (JSON)</a></p></section>';
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'Dataset', name: card.title, description: desc, url: base, license: 'https://www.apache.org/licenses/LICENSE-2.0',
    creator: { '@type': 'Person', name: 'Nick Kaufman' }, dateModified: last || card.read_date, isAccessibleForFree: true,
    distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: base + 'data/scorecard.json' }],
    variableMeasured: COLUMNS.map((c) => card.columns[c]),
  };
  return page({ base, path: '', title: fitTitle(card.title), description: desc, body, jsonld, depth: 0 });
}

export function gatewayDescription(card: Scorecard, g: Gateway): string {
  return g.name + ' and AI agent card orders, read from its own docs: accepts agent orders ' + g.cells.accepts.code + ', agent field in API ' + g.cells.api_field.code + ', reaches disputes ' + g.cells.disputes.code + '. ' + plural(gatewaySources(g).length, 'source page', 'source pages') + ' linked.';
}

export function gatewayPage(card: Scorecard, snaps: Snapshots, base: string, g: Gateway): string {
  const i = card.gateways.indexOf(g);
  const prev = card.gateways[i - 1], next = card.gateways[i + 1];
  const yes = COLUMNS.filter((c) => g.cells[c].code === 'YES').length;
  const srcN = gatewaySources(g).length;
  let cells = '';
  for (const c of COLUMNS) {
    const cell = g.cells[c];
    cells += '<section class="cell" id="' + c + '"><h2>' + esc(card.columns[c]) + '</h2><p class="verdict">' + chip(cell.code) + ' <span class="means">' + esc(card.codes[cell.code]) + '</span></p>' +
      (cell.note ? '<p class="cellnote">' + esc(cell.note) + '</p>' : '') +
      (cell.detail ? '<p class="detail">' + linkify(cell.detail) + '</p>' : '') +
      (cell.sources.length ? '<h3>Source pages</h3><ul class="src">' + cell.sources.map((s) => sourceLine(s, snaps)).join('') + '</ul>' : '<p class="meta">No source page is linked for this cell.</p>') + '</section>\n';
  }
  const notes = g.row_notes ? '<section class="cell" id="notes"><h2>Row notes</h2><p class="detail">' + linkify(g.row_notes) + '</p></section>\n' : '';
  const strip = '<div class="scroll"><table class="card strip"><thead><tr>' + COLUMNS.map((c) => '<th scope="col"><a href="#' + c + '">' + esc(card.columns[c]) + '</a></th>').join('') + '</tr></thead><tbody><tr>' + COLUMNS.map((c) => '<td>' + chip(g.cells[c].code) + '</td>').join('') + '</tr></tbody></table></div>';
  const body =
    '<p class="crumb"><a href="../../#card">The card</a> / ' + esc(g.name) + '</p>\n' +
    '<section class="hero"><h1>' + esc(g.name) + ': agent card orders, cell by cell</h1><p class="lede">' + yes + ' of ' + COLUMNS.length + (yes === 1 ? ' cells is' : ' cells are') + ' a documented YES. ' + plural(srcN, 'source page', 'source pages') + ' linked.</p><p class="q">' + esc(COPY.question) + '</p>' + strip + '</section>\n' +
    cells + notes +
    '<nav class="pager" aria-label="Gateways">' + (prev ? '<a href="../' + prev.id + '/">Previous: ' + esc(prev.name) + '</a>' : '<span></span>') + (next ? '<a href="../' + next.id + '/">Next: ' + esc(next.name) + '</a>' : '<span></span>') + '</nav>';
  const desc = gatewayDescription(card, g);
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebPage', name: g.name + ': agent card orders, cell by cell', description: desc, url: base + gatewayPath(g),
    isPartOf: { '@type': 'Dataset', name: card.title, url: base }, author: { '@type': 'Person', name: 'Nick Kaufman' }, about: g.name,
  };
  return page({ base, path: gatewayPath(g), title: fitTitle(g.name + ' and AI agent card orders'), description: desc, body, jsonld, depth: 2 });
}

export function legalPage(base: string, slug: string, title: string, paras: string[]): string {
  let body = '<p class="crumb"><a href="../#card">The card</a> / ' + esc(title) + '</p>\n<section class="hero legal"><h1>' + esc(title) + '</h1>';
  for (const p of paras) body += p.startsWith('## ') ? '<h2>' + esc(p.slice(3)) + '</h2>' : '<p>' + linkify(p).replace(esc(CONTACT), '<a href="mailto:' + CONTACT + '">' + CONTACT + '</a>') + '</p>';
  body += '<p class="meta">Last updated ' + LEGAL_UPDATED + '.</p></section>';
  return page({ base, path: slug + '/', title: title + ' | ' + SITE_NAME, description: title + ' for the ' + SITE_NAME + ' gateway scorecard site, run by Nick Kaufman. Last updated ' + LEGAL_UPDATED + '.', body, depth: 1 });
}

export const STYLE = `:root{--ink:#16211f;--soft:#43524f;--paper:#eef3f1;--panel:#fbfdfc;--line:#c9d5d0;--head:#dfe8e4;--accent:#0b5c4d;--yes:#0b5c4d;--part:#8a5a00;--ann:#1f4e8c;--no:#9b2c1e;--silent:#5a6462;--ask:#6b3f86}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font:400 17px/1.55 "IBM Plex Sans","Helvetica Neue",Arial,sans-serif}
a{color:var(--accent);text-underline-offset:3px}
a:focus-visible,.scroll:focus-visible,.figscroll:focus-visible,summary:focus-visible{outline:3px solid var(--ann);outline-offset:2px}
.skip{position:absolute;left:-999px}
.skip:focus{left:8px;top:8px;background:var(--panel);padding:12px 16px;z-index:9}
.top{display:flex;flex-wrap:wrap;gap:8px 24px;align-items:center;justify-content:space-between;padding:12px 24px;border-bottom:1px solid var(--line)}
.brand{font-weight:700;color:var(--ink);text-decoration:none;padding:12px 0}
.top nav{display:flex;flex-wrap:wrap;gap:4px 20px}
.top nav a{display:inline-block;padding:12px 0}
main{max-width:1320px;margin:0 auto;padding:16px 24px 64px}
section{margin:48px 0}
.hero{margin:32px 0 24px}
h1{font-size:clamp(1.7rem,4vw,2.6rem);line-height:1.34;letter-spacing:-.01em;margin:0 0 16px;max-width:22ch}
h2{font-size:1.35rem;line-height:1.34;margin:0 0 12px}
h3{font-size:1rem;margin:16px 0 4px}
p{max-width:68ch;margin:0 0 12px}
.lede{font-size:1.2rem;font-weight:500}
.q,.meta,.means{color:var(--soft)}
.meta{font-size:.92rem}
.crumb{font-size:.92rem;margin-top:16px}
.scroll{overflow-x:auto;border:1px solid var(--line);background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
thead th{font-weight:700;background:var(--head);white-space:nowrap}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
.card tbody th{min-width:150px;font-weight:500;position:sticky;left:0;background:var(--panel);box-shadow:1px 0 0 var(--line)}
.card thead th:first-child{position:sticky;left:0;z-index:1}
.card td{min-width:116px}
.card tbody th a{display:inline-block;padding:12px 0}
.strip th a{display:inline-block;padding:12px 0;white-space:normal}
.chip{display:inline-block;font-weight:700;font-size:.78rem;letter-spacing:.03em;padding:2px 7px;border:1.5px solid currentColor;border-radius:3px;background:var(--panel)}
.chip-yes{color:var(--yes)}.chip-part{color:var(--part)}.chip-ann{color:var(--ann)}.chip-no{color:var(--no)}.chip-silent{color:var(--silent);border-style:dashed}.chip-ask{color:var(--ask);border-style:dotted}
.note{display:block;margin-top:4px;color:var(--soft);font-size:.86rem}
.fig{margin:16px 0 0;max-width:820px}
.figscroll{overflow-x:auto}
.bars{width:100%;min-width:620px;height:auto;display:block}
.bars .lbl{font:500 13px "IBM Plex Sans",Arial,sans-serif;fill:var(--ink)}
.seg-yes{fill:var(--yes)}.seg-part{fill:var(--part)}.seg-ann{fill:var(--ann)}.seg-no{fill:var(--no)}.seg-silent{fill:#cfdad6}.seg-ask{fill:#e6eeeb;stroke:var(--silent);stroke-width:1;stroke-dasharray:3 3}
.segt{font:700 12px "IBM Plex Sans",Arial,sans-serif;fill:#fff}
.segt-silent,.segt-ask{fill:var(--ink)}
figcaption{margin-top:12px;max-width:68ch}
.alt{margin-top:12px}
summary{cursor:pointer;padding:12px 0;color:var(--accent)}
.counts{max-width:640px}
.codes{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px 32px;margin:0}
.code{display:flex;gap:12px;align-items:baseline}
.code dt{min-width:72px}
.code dd{margin:0}
.cell{border-top:1px solid var(--line);padding-top:24px;margin:32px 0}
.verdict{font-size:1.02rem}
.cellnote{font-weight:500}
.detail,.src{overflow-wrap:anywhere}
.src{margin:0;padding-left:20px;max-width:80ch}
.src li{margin:6px 0}
.cta{display:inline-block;background:var(--accent);color:#fff;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:4px;margin:8px 16px 8px 0}
.plain{display:inline-block;padding:12px 0}
.pager{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:16px;margin-top:48px}
.pager a{display:inline-block;padding:12px 0}
.foot{border-top:1px solid var(--line);padding:24px;color:var(--soft);font-size:.92rem}
.foot p{max-width:1272px;margin:0 auto 8px}
.foot a{display:inline-block;padding:12px 12px 12px 0}
.legal h2{margin-top:28px}
@media (max-width:640px){body{font-size:16px}main{padding:8px 16px 48px}.top{padding:8px 16px}section{margin:36px 0}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto;transition:none}}
`;

export const FAVICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="5" fill="#0b5c4d"/><path d="M7 10h18M7 16h18M7 22h11" stroke="#eef3f1" stroke-width="3" stroke-linecap="round"/></svg>\n';

// Every file of the site, keyed by its path under docs/.
export function buildSite(card: Scorecard, snaps: Snapshots, rawJson: string, base: string = DEFAULT_BASE): Record<string, string> {
  const files: Record<string, string> = {};
  files['index.html'] = indexPage(card, snaps, base);
  for (const g of card.gateways) files[gatewayPath(g) + 'index.html'] = gatewayPage(card, snaps, base, g);
  files['404.html'] = page({ base, path: '404.html', title: 'Page not found | ' + SITE_NAME, description: 'That page is not on this site. The scorecard and its gateway pages start at the card.', body: '<section class="hero"><h1>That page is not here</h1><p class="lede">The card has ' + card.gateways.length + ' gateways. Start there.</p><p><a class="cta" href="' + base + '">Go to the card</a></p></section>', depth: 0, noindex: true, abs: true }).replace(/href="(style\.css|favicon\.svg|favicon\.ico|favicon-32\.png|apple-touch-icon\.png)"/g, (_m, f) => 'href="' + base + f + '"').replace(/href="\.\/(#[a-z]+)?"/g, (_m, h) => 'href="' + base + (h ?? '') + '"');
  files['privacy/index.html'] = legalPage(base, 'privacy', 'Privacy', PRIVACY);
  files['terms/index.html'] = legalPage(base, 'terms', 'Terms', TERMS);
  files['style.css'] = STYLE;
  files['favicon.svg'] = FAVICON;
  files['data/scorecard.json'] = rawJson;
  files['robots.txt'] = 'User-agent: *\nAllow: /\n\nSitemap: ' + base + 'sitemap.xml\n';
  const last = latestCheck(snaps) || card.read_date;
  files['sitemap.xml'] = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + [''].concat(card.gateways.map(gatewayPath), ['privacy/', 'terms/']).map((p) => '  <url><loc>' + esc(base + p) + '</loc><lastmod>' + (p === 'privacy/' || p === 'terms/' ? LEGAL_UPDATED : last) + '</lastmod></url>').join('\n') + '\n</urlset>\n';
  files['llms.txt'] = '# ' + card.title + '\n\n> ' + COPY.question + ' ' + card.gateways.length + ' gateways, ' + COLUMNS.length + ' cells each, every cell read from the vendor\'s own public docs and linked to its source page. ' + COPY.keeper + '\n\n' + COPY.scope + ' ' + COPY.stale + '\n\n## Cell codes\n\n' + CODES.map((c) => '- ' + c + ': ' + card.codes[c]).join('\n') + '\n\n## Data\n\n- [The card](' + base + '): all ' + card.gateways.length + ' gateways in one table\n- [scorecard.json](' + base + 'data/scorecard.json): the same data with reading notes and source links\n\n## Gateways\n\n' + card.gateways.map((g) => '- [' + g.name + '](' + base + gatewayPath(g) + '): ' + COLUMNS.map((c) => card.columns[c] + ' ' + g.cells[c].code).join('; ')).join('\n') + '\n';
  files['.nojekyll'] = '';
  return files;
}
