---
name: agent-order-record
description: Look up what a payment gateway carries for card orders placed by AI agents (agent field, reporting, disputes, refunds), check an AEP evidence chain, turn a dispute bundle into Stripe evidence fields, run a Visa CE 3.0 check, or read the third party marker off a Braintree transaction. Use when the question is about agent placed card orders, chargebacks on them, or which gateway keeps the agent marker.
---

# Agent order record

Run these from the repo root. Node 22.18 or newer, no install step. Every command reads and prints. None of them sends, submits or writes.

    node bin/aor.ts gateways                  every gateway, one code per question
    node bin/aor.ts gateway <id> [column]     one gateway: code, vendor quote, sources, date read
    node bin/aor.ts find <column> <code>      gateways with that answer
    node bin/aor.ts verify <file.json>        AEP artifact chain: hashes, and signatures when the file has the key
    node bin/aor.ts stripe-evidence <bundle.json> [--raw raw.json] [--key base64]
    node bin/aor.ts ce3 <input.json>          Visa CE 3.0, reason code 10.4
    node bin/aor.ts braintree <tx.json>       read facilitator_details off a Braintree transaction

Add --json to the first three for the full data. Columns: accepts, api_field, reporting, disputes, risk_rules, token_scope, refunds. Codes: YES, PART, NO, SILENT, ASK, ANN.

## How to answer from it

Quote the cell's source page and the date it was read. A cell is a dated reading of a vendor page, and those pages change.

SILENT means the pages read say nothing. Do not turn it into "the gateway does not support this".

This is a prototype. The Stripe fields have not been filed on a real dispute. Say so when you hand them to someone, and have a person read them first.

The Braintree reader has not been run on a live agent order. facilitator_details names any third party application, so report the name and do not call the buyer an AI agent unless the name says so.

Exit codes: 0 ok, 1 the check failed, the render was refused or no marker was found, 2 bad usage.
