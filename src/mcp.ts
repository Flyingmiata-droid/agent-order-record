// A small MCP server (Model Context Protocol, stdio transport) so an AI agent
// can read the scorecard and run the checks. JSON-RPC 2.0, one message per
// line. No packages. Every tool is read only: nothing is sent or written.
import { createInterface } from 'node:readline';
import { CODES, COLUMNS } from './scorecard.ts';
import { BadInput, braintreeRead, ce3, findGateways, getGateway, listGateways, stripeEvidence, verifyAepChain } from './tools.ts';

// Newest first. The server answers with the client's version when it is in
// this list and with the newest one otherwise (MCP lifecycle, version negotiation).
export const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'agent-order-record', version: '0.0.1' };

type Json = Record<string, unknown>;
interface Tool { name: string; title: string; description: string; inputSchema: Json; run: (args: Json) => unknown }

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS: Tool[] = [
  {
    name: 'list_gateways', title: 'List gateways',
    description: 'Lists the payment gateways in the scorecard with one code per question (does it accept agent placed card orders, does the merchant get an agent field, does it reach the dispute, and so on). Start here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => listGateways(),
  },
  {
    name: 'get_gateway', title: 'Read one gateway',
    description: 'Returns the scorecard cells for one gateway: the code, the quoted vendor text, the source pages and the date read. Pass column to get one question only.',
    inputSchema: {
      type: 'object', required: ['gateway'], additionalProperties: false,
      properties: { gateway: { type: 'string', description: 'Gateway id or name, for example "stripe" or "Adyen".' }, column: { type: 'string', enum: [...COLUMNS] } },
    },
    run: (a) => getGateway(a),
  },
  {
    name: 'find_gateways', title: 'Find gateways by answer',
    description: 'Lists the gateways whose answer to one question has the given code. Example: column "disputes", code "YES" shows which gateways document an agent field on the dispute.',
    inputSchema: {
      type: 'object', required: ['column', 'code'], additionalProperties: false,
      properties: { column: { type: 'string', enum: [...COLUMNS] }, code: { type: 'string', enum: [...CODES] } },
    },
    run: (a) => findGateways(a),
  },
  {
    name: 'verify_aep_chain', title: 'Check an AEP artifact chain',
    description: 'Recomputes the SHA-256 hash chain of AEP artifacts and, when a public key is given, checks each Ed25519 signature. Reports what it did not check.',
    inputSchema: {
      type: 'object', required: ['artifacts'], additionalProperties: false,
      properties: { artifacts: { type: 'array', items: { type: 'object' }, description: 'AEP artifact records, in order.' }, public_key_base64: { type: 'string', description: 'Ed25519 public key, 32 bytes, base64. Without it signatures are not checked.' } },
    },
    run: (a) => verifyAepChain(a),
  },
  {
    name: 'render_stripe_evidence', title: 'Turn a bundle into Stripe dispute fields',
    description: 'Takes an AEP DisputeBundle and returns the text fields for Stripe dispute evidence plus page text for the three file fields. Refuses a bundle that failed verification or whose output looks like it holds a card number. Prototype: it does not call Stripe.',
    inputSchema: {
      type: 'object', required: ['bundle'], additionalProperties: false,
      properties: {
        bundle: { type: 'object', description: 'AEP DisputeBundle.' },
        raw: { type: 'object', description: 'Clear text the merchant holds outside the chain: customer_purchase_ip, customer_email_address, customer_name, shipping_address.' },
        public_key_base64: { type: 'string' },
        reverify: { type: 'boolean', description: 'false skips the local chain re-check and returns a warning instead.' },
        platform_countersigned: { type: 'boolean' },
      },
    },
    run: (a) => stripeEvidence(a),
  },
  {
    name: 'check_ce3', title: 'Visa CE 3.0 check',
    description: 'Says whether a disputed order and its prior orders meet Visa Compelling Evidence 3.0 (reason code 10.4), and why. Counts device and IP values only when they belong to the cardholder, not the AI platform.',
    inputSchema: { type: 'object', required: ['input'], additionalProperties: false, properties: { input: { type: 'object', description: 'network, reason_code, dispute_date, disputed, priors.' } } },
    run: (a) => ce3(a),
  },
  {
    name: 'read_braintree_transaction', title: 'Read the agent marker off a Braintree transaction',
    description: 'Takes a Braintree transaction the merchant already holds and reports facilitator_details (the OAuth application that owned the payment information, for example an AI agent platform), plus which fields to keep because Braintree\'s dispute object does not carry the marker. Prototype: it does not call Braintree.',
    inputSchema: { type: 'object', required: ['transaction'], additionalProperties: false, properties: { transaction: { type: 'object', description: 'The transaction object, or a result with it under "transaction". snake_case or camelCase keys.' } } },
    run: (a) => braintreeRead(a),
  },
];

const err = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const ok = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });

// One message in, one reply out (null for a notification).
export function handle(msg: unknown): Json | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return err(null, -32600, 'Invalid Request');
  const m = msg as Json;
  const isNote = !('id' in m);
  if (m.jsonrpc !== '2.0' || typeof m.method !== 'string') return 'method' in m || !isNote && !('result' in m) && !('error' in m) ? err(m.id, -32600, 'Invalid Request') : null;
  if (isNote) return null;
  const params = (typeof m.params === 'object' && m.params !== null ? m.params : {}) as Json;
  switch (m.method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      const version = typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
      return ok(m.id, {
        protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO,
        instructions: 'Read only. Scorecard of what each payment gateway carries for card orders placed by AI agents, plus checks for AEP evidence chains, Stripe dispute fields and Visa CE 3.0, and a reader for the marker on a Braintree transaction. Prototype: cells are dated readings of vendor pages, so quote the source and date with any answer.',
      });
    }
    case 'ping': return ok(m.id, {});
    case 'tools/list':
      return ok(m.id, { tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...READ_ONLY } })) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(m.id, -32602, 'Unknown tool: ' + String(params.name));
      const args = params.arguments === undefined || params.arguments === null ? {} : params.arguments;
      if (typeof args !== 'object' || Array.isArray(args)) return err(m.id, -32602, 'arguments must be an object');
      try {
        const out = tool.run(args as Json) as Json;
        return ok(m.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: out.refused === true });
      } catch (e) {
        const text = e instanceof BadInput ? e.message : 'internal error: ' + (e as Error).message;
        return ok(m.id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default: return err(m.id, -32601, 'Method not found: ' + m.method);
  }
}

export function serve(input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): void {
  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let reply: Json | null;
    try { reply = handle(JSON.parse(line)); } catch { reply = err(null, -32700, 'Parse error'); }
    if (reply) output.write(JSON.stringify(reply) + '\n');
  });
}
