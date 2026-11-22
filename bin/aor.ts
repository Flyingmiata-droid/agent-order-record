#!/usr/bin/env node
// Command line front for the repo. Run: node bin/aor.ts help
// Read only. Exit 0 ok, 1 the check failed or was refused, 2 bad usage.
import { readFileSync } from 'node:fs';
import { COLUMNS } from '../src/scorecard.ts';
import { serve } from '../src/mcp.ts';
import { BadInput, ce3, findGateways, getGateway, listGateways, stripeEvidence, verifyAepChain } from '../src/tools.ts';

const HELP = `agent-order-record, prototype. Read only: nothing is sent anywhere.

  node bin/aor.ts gateways                     every gateway, one code per question
  node bin/aor.ts gateway <id> [column]        one gateway: code, vendor quote, sources, date read
  node bin/aor.ts find <column> <code>         gateways with that answer, e.g. find disputes YES
  node bin/aor.ts verify <file.json>           check an AEP artifact chain (vector file or DisputeBundle)
  node bin/aor.ts stripe-evidence <bundle.json> [--raw raw.json] [--key base64] [--no-reverify]
  node bin/aor.ts ce3 <input.json>             Visa CE 3.0 check
  node bin/aor.ts mcp                          MCP server on stdin and stdout

Columns: ${COLUMNS.join(', ')}
Add --json to gateways, gateway or find for the full data. Use - as the file to read stdin.`;

function readJson(path: string | undefined): Record<string, unknown> {
  if (!path) throw new BadInput('a JSON file is required');
  let text: string;
  try { text = readFileSync(path === '-' ? 0 : path, 'utf8'); } catch (e) { throw new BadInput('cannot read ' + path + ': ' + (e as Error).message); }
  try { return JSON.parse(text); } catch { throw new BadInput(path + ' is not JSON'); }
}
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

function main(argv: string[]): number {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const opt = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const skip = new Set([opt('--raw'), opt('--key')].filter((v) => v !== undefined));
  const [cmd, ...rest] = argv.filter((a) => !a.startsWith('--') && !skip.has(a));
  const json = flags.has('--json');
  switch (cmd) {
    case undefined: case 'help': console.log(HELP); return flags.has('--help') || cmd ? 0 : 2;
    case 'gateways': {
      const out = listGateways();
      if (json) { print(out); return 0; }
      const w = Math.max(...out.gateways.map((g) => g.id.length));
      console.log('id'.padEnd(w) + '  ' + COLUMNS.map((c) => c.padEnd(11)).join(' '));
      for (const g of out.gateways) console.log(g.id.padEnd(w) + '  ' + COLUMNS.map((c) => String(g.codes[c]).padEnd(11)).join(' '));
      console.log('\nread ' + out.read_date + ' and later, per cell. ' + out.caveat);
      return 0;
    }
    case 'gateway': {
      const out = getGateway({ gateway: rest[0], column: rest[1] });
      if (json) { print(out); return 0; }
      console.log(out.name + ' (' + out.id + ')');
      for (const [c, cell] of Object.entries(out.cells)) {
        console.log('\n' + c + ': ' + cell.code + (cell.note ? ' ' + cell.note : '') + '\n  ' + cell.question);
        if (cell.detail) console.log('  ' + cell.detail);
        for (const s of cell.sources) console.log('  source: ' + s.url + (s.page_date ? ' (' + s.page_date + ')' : ''));
      }
      console.log('\n' + out.caveat);
      return 0;
    }
    case 'find': {
      const out = findGateways({ column: rest[0], code: rest[1] });
      if (json) { print(out); return 0; }
      console.log(out.count + ' of ' + out.of + ' gateways: ' + out.column + ' = ' + out.code + ' (' + out.meaning + ')');
      for (const g of out.gateways) console.log('  ' + g.id + (g.note ? '  ' + g.note : ''));
      console.log('\n' + out.caveat);
      return 0;
    }
    case 'verify': {
      const doc = readJson(rest[0]);
      const out = verifyAepChain({ artifacts: doc.artifacts, public_key_base64: opt('--key') ?? doc.ed25519_public_key_base64 });
      print(out);
      return out.hashChainIntact && out.signaturesValid !== false ? 0 : 1;
    }
    case 'stripe-evidence': {
      const out = stripeEvidence({ bundle: readJson(rest[0]), raw: opt('--raw') ? readJson(opt('--raw')) : undefined, public_key_base64: opt('--key'), reverify: flags.has('--no-reverify') ? false : undefined });
      print(out);
      return out.refused ? 1 : 0;
    }
    case 'ce3': {
      const out = ce3({ input: readJson(rest[0]) });
      print(out);
      return out.qualifies ? 0 : 1;
    }
    case 'mcp': serve(); return -1;
    default: throw new BadInput('unknown command "' + cmd + '". Run: node bin/aor.ts help');
  }
}

try {
  const code = main(process.argv.slice(2));
  if (code >= 0) process.exitCode = code;
} catch (e) {
  if (!(e instanceof BadInput)) throw e;
  console.error('aor: ' + e.message);
  process.exitCode = 2;
}
