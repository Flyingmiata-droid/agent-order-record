// Re-reads each source page and flags the cells whose page text changed since
// the last snapshot. It reads public pages only. It changes no cell: a human
// re-reads the page and edits the scorecard.
import { createHash } from 'node:crypto';

export interface Snapshot { hash: string | null; status: 'ok' | 'unreachable'; http?: number; first_seen: string; last_checked: string; last_changed?: string }
export type Snapshots = Record<string, Snapshot>;
export type Fetcher = (url: string) => Promise<{ status: number; text: string }>;
export interface RecheckResult { snapshots: Snapshots; changed: string[]; unreachable: string[]; fresh: string[]; same: string[] }

// Page text with markup, scripts and runs of whitespace taken out, so a new
// build hash or tracking tag in the HTML does not read as a doc change.
export function normalizePage(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pageHash(html: string): string {
  return createHash('sha256').update(normalizePage(html), 'utf8').digest('hex');
}

export async function recheck(urls: string[], prior: Snapshots, fetcher: Fetcher, today: string, concurrency = 6): Promise<RecheckResult> {
  const snapshots: Snapshots = { ...prior };
  const res: RecheckResult = { snapshots, changed: [], unreachable: [], fresh: [], same: [] };
  const queue = [...urls];
  const work = async () => {
    for (;;) {
      const url = queue.shift();
      if (url === undefined) return;
      const old = prior[url];
      let got: { status: number; text: string } | null = null;
      try { got = await fetcher(url); } catch { got = null; }
      if (!got || got.status < 200 || got.status >= 300 || normalizePage(got.text).length < 200) {
        // A page we cannot read is not a changed page. Keep the old hash.
        snapshots[url] = { hash: old?.hash ?? null, status: 'unreachable', http: got?.status, first_seen: old?.first_seen ?? today, last_checked: today, last_changed: old?.last_changed };
        res.unreachable.push(url);
        continue;
      }
      const hash = pageHash(got.text);
      if (!old || old.hash === null) {
        snapshots[url] = { hash, status: 'ok', http: got.status, first_seen: old?.first_seen ?? today, last_checked: today };
        res.fresh.push(url);
      } else if (old.hash !== hash) {
        snapshots[url] = { hash, status: 'ok', http: got.status, first_seen: old.first_seen, last_checked: today, last_changed: today };
        res.changed.push(url);
      } else {
        snapshots[url] = { ...old, status: 'ok', http: got.status, last_checked: today };
        res.same.push(url);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, work));
  return res;
}
