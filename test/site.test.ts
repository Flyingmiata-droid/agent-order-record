import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { COLUMNS } from '../src/scorecard.ts';
import type { Scorecard } from '../src/scorecard.ts';
import { buildSite, CF_BEACON_TOKEN, countCodes, DEFAULT_BASE, esc, gatewayPath, gatewaySources, linkify } from '../src/site.ts';

const raw = readFileSync(new URL('../data/scorecard.json', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const card = JSON.parse(raw) as Scorecard;
const snaps = JSON.parse(readFileSync(new URL('../data/snapshots.json', import.meta.url), 'utf8'));
const site = buildSite(card, snaps, raw);
const pages = Object.keys(site).filter((p) => p.endsWith('.html'));
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<\/?a[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('site: one page per gateway, plus the card, the 404 and the plumbing', () => {
  for (const g of card.gateways) assert.ok(site[gatewayPath(g) + 'index.html'], g.id);
  assert.equal(pages.length, card.gateways.length + 4);
  for (const f of ['index.html', '404.html', 'llms.txt', 'privacy/index.html', 'terms/index.html', 'style.css', 'favicon.svg', 'robots.txt', 'sitemap.xml', 'data/scorecard.json', '.nojekyll']) assert.ok(f in site, f);
  assert.equal(site['data/scorecard.json'], raw);
});

test('site: every cell shows its code, note, detail and every source link', () => {
  for (const g of card.gateways) {
    const html = site[gatewayPath(g) + 'index.html'];
    const t = text(html);
    for (const c of COLUMNS) {
      const cell = g.cells[c];
      assert.ok(html.includes('id="' + c + '"'), g.id + '.' + c);
      assert.ok(t.includes(card.columns[c]), g.id + '.' + c + ' title');
      if (cell.note) assert.ok(t.includes(cell.note), g.id + '.' + c + ' note');
      if (cell.detail) assert.ok(t.includes(cell.detail.replace(/\s+/g, ' ')), g.id + '.' + c + ' detail');
    }
    for (const url of gatewaySources(g)) assert.ok(html.includes('href="' + esc(url) + '"'), g.id + ' ' + url);
    if (g.row_notes) assert.ok(t.includes(g.row_notes.replace(/\s+/g, ' ')), g.id + ' row notes');
  }
});

test('site: the card page table matches the data cell for cell', () => {
  const html = site['index.html'];
  const body = html.slice(html.indexOf('<table class="card">'), html.indexOf('</table>', html.indexOf('<table class="card">')));
  const rows = body.split('<tr>').slice(2);
  assert.equal(rows.length, card.gateways.length);
  rows.forEach((r, i) => {
    const g = card.gateways[i];
    assert.ok(r.includes('href="' + gatewayPath(g) + '"'), g.id);
    const codes = [...r.matchAll(/class="chip chip-[a-z]+">([A-Z]+)</g)].map((m) => m[1]);
    assert.deepEqual(codes, COLUMNS.map((c) => g.cells[c].code), g.id);
  });
});

test('site: every number in the lede and the figure is counted from the data', () => {
  const t = text(site['index.html']);
  const n = card.gateways.length;
  const yes = (c: (typeof COLUMNS)[number]) => countCodes(card, c).YES;
  assert.ok(t.includes(n + ' gateways read against their own docs.'));
  const dc = countCodes(card, 'disputes');
  assert.ok(t.includes(dc.YES + ' are a documented YES on the agent signal reaching the dispute.'));
  assert.ok(t.includes('On that column: ' + (['YES', 'PART', 'NO', 'SILENT', 'ASK', 'ANN'] as const).filter((c) => dc[c] > 0).map((c) => dc[c] + ' ' + c).join(', ') + '.'));
  for (const g of card.gateways) assert.ok(site['llms.txt'].includes('](' + DEFAULT_BASE + gatewayPath(g) + '): '), 'llms.txt ' + g.id);
  assert.ok(t.includes('Documented YES, out of ' + n + ' gateways: ' + yes('accepts') + ' accept agent orders, ' + yes('api_field') + ' name an agent field in the API, ' + yes('reporting') + ' show it in reporting, ' + yes('disputes') + ' carry it to the dispute.'));
  // The headline over the figure is only true while no row is YES on disputes.
  assert.equal(yes('disputes'), 0, 'a gateway now documents the signal on a dispute: rewrite the finding heading in src/site.ts');
  for (const c of COLUMNS) {
    const counts = countCodes(card, c);
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), n);
  }
});

test('site: head tags, one h1, no skipped heading level, ASCII only', () => {
  const titles = new Set<string>();
  const descs = new Set<string>();
  for (const p of pages) {
    const html = site[p];
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, p + ' h1');
    const title = (html.match(/<title>([^<]+)<\/title>/) ?? [])[1];
    assert.ok(title && title.length <= 70, p + ' title length ' + (title ?? '').length);
    assert.ok(!titles.has(title), p + ' duplicate title');
    titles.add(title);
    const desc = (html.match(/<meta name="description" content="([^"]+)"/) ?? [])[1];
    assert.ok(desc && desc.length >= 50 && desc.length <= 200, p + ' description length ' + (desc ?? '').length);
    assert.ok(!descs.has(desc), p + ' duplicate description');
    descs.add(desc);
    assert.ok(html.includes('<meta property="og:image" content="' + DEFAULT_BASE + 'og.png">'), p + ' og:image');
    if (p !== '404.html') assert.ok(html.includes('<link rel="canonical" href="' + DEFAULT_BASE + p.replace(/index\.html$/, '') + '">'), p + ' canonical');
    const levels = [...html.matchAll(/<h([1-6])[ >]/g)].map((m) => Number(m[1]));
    levels.forEach((l, i) => assert.ok(i === 0 || l - levels[i - 1] <= 1, p + ' heading jump'));
    for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
  }
  for (const [p, body] of Object.entries(site)) for (let i = 0; i < body.length; i++) assert.ok(body.charCodeAt(i) < 128, p + ' non-ASCII at ' + i);
});

test('site: sitemap lists every indexable page and no other', () => {
  const locs = [...site['sitemap.xml'].matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [DEFAULT_BASE].concat(card.gateways.map((g) => DEFAULT_BASE + gatewayPath(g)), [DEFAULT_BASE + 'privacy/', DEFAULT_BASE + 'terms/']));
  assert.ok(site['robots.txt'].includes('Sitemap: ' + DEFAULT_BASE + 'sitemap.xml'));
  assert.ok(site['404.html'].includes('noindex'));
});

test('site: internal links land on a page that exists', () => {
  for (const p of pages) {
    const dir = p.replace(/[^/]*$/, '');
    for (const m of site[p].matchAll(/href="([^"]+)"/g)) {
      const href = m[1];
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const target = new URL(href, 'http://x/' + dir).pathname.slice(1);
      const file = target === '' || target.endsWith('/') ? target + 'index.html' : target;
      assert.ok(file in site || (['og.png', 'favicon.ico', 'favicon-32.png', 'apple-touch-icon.png'].includes(file) && existsSync(new URL('../docs/' + file, import.meta.url))), p + ' -> ' + href);
    }
  }
});

test('site: text is escaped and URLs become links', () => {
  assert.equal(linkify('a <b> https://x.example/p?q=1. Then "c"'), 'a &lt;b&gt; <a href="https://x.example/p?q=1" rel="noopener">https://x.example/p?q=1</a>. Then &quot;c&quot;');
});

test('site: docs/ on disk is the current build (run npm run build:site after a scorecard change)', () => {
  for (const [p, body] of Object.entries(site)) {
    const f = new URL('../docs/' + p, import.meta.url);
    assert.ok(existsSync(f), 'docs/' + p + ' is missing');
    assert.equal(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), body, 'docs/' + p + ' is stale');
  }
});

test('site: every page links privacy and terms; outside requests are the font and the page view counter, nothing else', () => {
  for (const p of pages) {
    assert.match(site[p], /href="[^"]*privacy\/">Privacy<\/a>/, p);
    assert.match(site[p], /href="[^"]*terms\/">Terms<\/a>/, p);
    const scripts = [...site[p].matchAll(/<script(?! type="application\/ld\+json")[^>]*>/g)].map((m) => m[0]);
    assert.deepEqual(scripts, CF_BEACON_TOKEN ? ['<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon=\'{"token": "' + CF_BEACON_TOKEN + '"}\'>'] : [], p + ' scripts');
    assert.match(CF_BEACON_TOKEN, /^([0-9a-f]{32})?$/);
    const loads = [...site[p].matchAll(/<link rel="(?:stylesheet|preconnect|icon)" href="(https?:[^"]+)"/g)].map((m) => new URL(m[1]).host);
    if (p !== '404.html') assert.deepEqual([...new Set(loads)], ['fonts.bunny.net'], p);
    assert.ok(!/<img|<iframe|<form|<input/.test(site[p]), p + ' has an embed or a form');
  }
  // The privacy page names every company a page load touches.
  const priv = site['privacy/index.html'];
  for (const name of ['GitHub', 'Bunny Fonts'].concat(CF_BEACON_TOKEN ? ['Cloudflare Web Analytics'] : [])) assert.ok(priv.includes(name), name);
  {
  }
});

test('site: share image and icons are on disk, with the sizes the head tags claim', () => {
  const png = (name: string) => {
    const b = readFileSync(new URL('../docs/' + name, import.meta.url));
    assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', name);
    return [b.readUInt32BE(16), b.readUInt32BE(20), b.length];
  };
  const og = png('og.png');
  assert.deepEqual(og.slice(0, 2), [1200, 630]);
  assert.ok(og[2] < 1000000, 'og.png over 1 MB');
  assert.deepEqual(png('apple-touch-icon.png').slice(0, 2), [180, 180]);
  assert.deepEqual(png('favicon-32.png').slice(0, 2), [32, 32]);
  assert.ok(existsSync(new URL('../docs/favicon.ico', import.meta.url)));
  // No provenance or tool stamp rides in the images.
  for (const f of ['og.png', 'apple-touch-icon.png', 'favicon-32.png']) assert.ok(!/c2pa|caBX|tEXt|iTXt|eXIf/.test(readFileSync(new URL('../docs/' + f, import.meta.url)).toString('latin1')), f + ' carries metadata');
});
