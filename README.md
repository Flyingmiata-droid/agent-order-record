An AI agent buys something with a card. A month later the cardholder says "I never ordered that." What does the merchant have to show?

Mostly nothing a card dispute form can take. The evidence formats for agent orders (AEP and a few others) stop at "export a bundle". This repo works on the step after that: what each gateway can carry, in which field, and what the bundle turns into when you file the dispute.

It does not define a new evidence format. It reads an AEP DisputeBundle.

This is a prototype. It has not been run against a Stripe account, live or test. Nothing here sends, submits or decides a dispute.

## What this is not

It does not capture anything at checkout. Hosted services already do that part. Evidora records the step where a person sets up the agent, and Chargeflow fights chargebacks for merchants. If you want that, use one of them. This repo is the free part next to them: what each gateway carries, read from its own docs and dated, plus code that turns a bundle into dispute fields.

## What is here

A gateway scorecard, as data. SCORECARD.md is the readable copy and data/scorecard.json is the same thing for code: 25 rows, 7 questions each. A YES or PART cell quotes the vendor page it came from, with the date. Five of them still need the exact page pinned and are listed under source_gaps. For SILENT and ASK cells, the row detail in SCORECARD.md names the pages that were read. The questions are plain ones. Does the gateway accept agent orders? Does the merchant get an agent field in the API? Does it show in reporting? Does it reach the dispute? Do risk rules read it? Is the token scoped to one merchant? Is there refund guidance?

A re-check script. scripts/recheck.ts fetches every source page again, hashes the text and lists the cells that lean on a page that changed. It never edits a cell. A person re-reads the page.

An AEP chain check. src/aep.ts and src/jcs.ts do canonical JSON, the SHA-256 chain and Ed25519 signatures. They pass AEP conformance vectors a, b and h byte for byte.

A Stripe evidence renderer. src/stripe.ts takes a DisputeBundle and returns the ten text fields for Stripe dispute evidence, plus page text for the three file fields. It refuses a bundle whose verification failed, is cached or contradicts itself, an empty bundle, a chain whose hashes no longer match (unless you pass reverify: false, which gives a warning instead), and any output that looks like it holds a card number. Signatures are checked again only when you pass the public key. Without the key you get a warning, not a refusal.

A Visa CE 3.0 check. src/ce3.ts takes the disputed order and the prior orders and answers yes or no, with the reason. It counts device and IP values only when they belong to the cardholder. That is our reading, not a Visa or Stripe rule: on an agent order they often belong to the AI platform, and then they say nothing about the buyer.

## Run it

Node 22.18 or newer. No install step and no packages.

    node --test "test/*.test.ts"
    node examples/stripe-evidence.ts
    node scripts/recheck.ts

The example takes AEP's own test vector b, checks the chain, and prints the Stripe evidence fields a merchant would end up with. The product name in that vector has accents and a long dash on purpose. It is AEP's text encoding test.

## Use it from the command line or from an AI agent

One command line tool wraps the scorecard and the checks. It reads and prints. Nothing is sent.

    node bin/aor.ts gateways
    node bin/aor.ts find disputes YES
    node bin/aor.ts gateway stripe api_field
    node bin/aor.ts verify test/fixtures/aep/b-chain.json
    node bin/aor.ts braintree test/fixtures/braintree/acp-transaction.json

The second line asks which gateways document an agent field on the dispute. Today it prints 0 of 25.

The last line reads a Braintree transaction you already hold and prints facilitator_details, the one place Braintree names the application behind the order. It also lists the fields to keep, because Braintree's dispute object does not carry that name. Braintree fills facilitator_details for any third party, not only AI agents, so the reader reports the application name and leaves the call to you. The fixture is made up, and the reader has not been run on a live agent order.

The same seven operations run as an MCP server, so an agent can look a gateway up while it works. It talks over stdio, needs no packages, and marks every tool read only. Point your client at it with your own path:

    { "mcpServers": { "agent-order-record": { "command": "node", "args": ["/path/to/agent-order-record/bin/aor.ts", "mcp"] } } }

The tools are list_gateways, get_gateway, find_gateways, verify_aep_chain, render_stripe_evidence, check_ce3 and read_braintree_transaction. On 2026-11-21 the server was run against the official MCP TypeScript client, SDK 1.32.2: connect, list, call, a bad argument and an unknown tool. It is not on npm. Node refuses to run TypeScript from inside node_modules, so clone the repo.

skills/agent-order-record/SKILL.md is a short skill file that tells a coding agent when to use these commands.

## Does the agent signal reach the card network?

Only Stripe documents it. No gateway documents it reaching the dispute.

When an AI agent places a card order, the fact that an agent did it can live in three places: the gateway's API, the card network's authorization message, and the dispute the merchant answers a month later. The table follows that signal through all three for 16 gateways.

| Gateway | Accepts agent orders | Agent field for the merchant | Signal to the network | Reaches the dispute |
|---|---|---|---|---|
| Stripe | YES (public preview) | YES PaymentIntent.agent_details | YES agentic network tokens | SILENT |
| Braintree (PayPal) | YES | YES facilitator_details, response only | SILENT | SILENT |
| Adyen | YES (limited, enterprise US) | PART request side | SILENT | SILENT |
| Worldpay | YES (ACP) | PART paymentInstrument.type delegate | SILENT | ASK |
| Checkout.com | YES | SILENT | ANN (marketing page only) | SILENT |
| Shopify Payments | YES | SILENT | SILENT | SILENT |
| Square | YES | SILENT | SILENT | SILENT |
| PayPal (wallet) | YES | SILENT | ANN (Mastercard Agent Pay pilot) | PART |
| Cybersource (Visa) | YES (pilot) | SILENT | PART (pilot, token and cryptogram only) | SILENT |
| Nuvei | ANN | SILENT | ANN | SILENT |
| Fiserv | ANN | ASK | ANN | SILENT |
| Global Payments | ANN | ASK | SILENT | SILENT |
| Authorize.net (Visa) | ASK | SILENT | SILENT | SILENT |
| NMI | SILENT | SILENT | not read yet | SILENT |
| Elavon | ASK | SILENT | not read yet | SILENT |
| Helcim | ASK | SILENT | not read yet | SILENT |

YES means the vendor's own docs say it. For the first two columns and the dispute column, the field or sentence is quoted in SCORECARD.md; for the network column, the source is listed below. PART is documented in part. SILENT means the pages read say nothing, which is different from the vendor having nothing. ASK means no relevant doc could be found or read. ANN means announced, with no doc or live product.

Stripe is the one YES in the network column. Its shared payment token page says Stripe may use Visa Intelligent Commerce, Mastercard Agent Pay and American Express ACE Kit tokens for the seller and "submits the requested data to the card networks". Cybersource comes closest after that. Its Intelligent Commerce guide hands back an agentic token with a TAVV cryptogram, but its authorization endpoint has no agent field, so all the network gets is the token. Adyen, Worldpay and Braintree accept ACP tokens and stop there.

The networks don't define a flag either. Visa's Trusted Agent Protocol and Mastercard's Web Bot Auth sign the agent's web requests to the merchant's site; their specs say nothing about the authorization message. Visa Intelligent Commerce and Mastercard Agent Pay carry the agent inside the token. EMVCo's draft agentic framework from September 2026 lists "Agentic Transaction Indicators" as later work. None of the network docs read adds a dispute reason code for agent orders.

Even Stripe's signal is gone by the dispute. When a shared payment token payment is confirmed, Stripe clones the card's payment method, and its docs say refunds and reporting then behave as if the merchant had supplied that payment method directly. The Dispute object has no agent field. Across all 16, 15 were checked for an agent field in disputes, and none has one. Authorize.net has no dispute product of its own: its support page says it does not handle card chargebacks and sends the merchant to its processor. Worldpay's dispute docs could not be read. One fraud rule engine reads an agent signal, Stripe Radar's is_agent_initiated, and that is Stripe's own detection, which does not reach the dispute either.

Nine rows were added on 2026-11-21 for firms named in Visa's Agentic Ready release, and they do not change that. Airwallex marks the payment attempt as agentic and names no agent. Getnet returns agentic_protocol in a sandbox only preview. Seven of the nine have a dispute or chargeback object and none carries an agent field. SCORECARD.md also sets what Visa's release says about each named firm next to what that firm's own docs show.

The small merchant gateways are the quiet ones. NMI, Authorize.net, Elavon and Helcim have no doc saying they accept agent orders (NMI has blog posts only). Their merchants are likely to see the first "my agent did it" chargebacks.

### How the cells were read

Every cell comes from a vendor's own docs, API reference or spec, changelog, terms or press release, on the date shown. The first two columns and the dispute column were read 2026-10-15, with Stripe and Braintree read again 2026-11-14 and 2026-11-17, and the Fiserv, Global Payments and Authorize.net dispute cells read 2026-11-21. The network column was read 2026-11-18. The rows were gathered with AI help. The claim behind each cell is the page it came from, which SCORECARD.md links, and scripts/recheck.ts lists the cells whose pages changed since.

Network column sources:

- Stripe: https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens
- Cybersource: https://developer.visaacceptance.com/docs/vas/en-us/intelligent-commerce/developer/all/rest/intelligent-commerce.html
- Checkout.com: https://www.checkout.com/agentic-commerce
- PayPal: https://www.mastercard.com/us/en/news-and-trends/press/2025/october/Mastercard-and-PayPal-join-forces.html
- Nuvei: https://www.nuvei.com/posts/nuvei-completes-first-party-in-agent-payment-with-visa-unveils-merchant-led-agentic-payments-strategy
- Fiserv: https://www.businesswire.com/news/home/20251222291522/en/
- Visa Trusted Agent Protocol: https://developer.visa.com/docs/trusted-agent-protocol/trusted-agent-protocol-specifications
- Visa Intelligent Commerce: https://developer.visa.com/docs/visa-intelligent-commerce/concepts
- Mastercard Agent Pay Acceptance Framework: https://www.mastercard.com/us/en/news-and-trends/stories/2025/agentic-commerce-framework.html
- EMVCo: https://www.emvco.com/news-publications/emvco-newsletter-q3-2026/

Dispute column sources read 2026-11-21:

- Fiserv Disputes API v1.3.0 (EMEA developer portal): https://docs.fiserv.dev/public/docs/disputes
- Global Payments Disputes Management guide: https://developer.globalpayments.com/docs/operations/disputes-management-guide
- Authorize.net chargebacks: https://support.authorize.net/knowledgebase/article/000001216/en-us

If a cell is wrong or out of date, open an issue with the link and the date you read it. That is the most useful thing anyone can send.

## What is not built

No PDF output. The three file fields come out as text and you make the PDF.

No call to Stripe.

The Stripe renderer does not fill the Visa CE 3.0 block yet. The check exists, but the renderer does not call it.

No Braintree, Adyen or PayPal renderer. One reader pulls the marker off a gateway object so far, for Braintree (src/braintree.ts). Stripe and Adyen have none yet.

sealedBundleHash is not checked. AEP has not pinned the bundle signature rule yet (its vector c is pending). Until then a chain cut short at the end, with its verification block edited to match, is not caught.

Bad input types (a number where text belongs, a missing block) throw a plain error, not a clean refusal.

## One thing found while building

AEP Appendix C gives one text limit for Stripe, about 150,000 characters combined. That is right. But Stripe also caps each field: 20,000 on the long text fields (product_description, access_activity_log, uncategorized_text) and 5,000 on the short ones. Read 2026-11-09 in Stripe's OpenAPI file, API version 2026-09-30.endive. The renderer cuts each field to its own cap on a word boundary. That same API version also rejects evidence over the card network's page limit (error dispute_evidence_page_limit_exceeded, Stripe changelog 2026-09-30.endive). The renderer does not estimate pages yet.

## Where the facts come from

Every scorecard cell comes from a vendor's own docs, API reference, changelog, terms or press release. A SILENT cell means the pages named say nothing. It does not mean the vendor has nothing.

The first pass over the rows was done with AI help, and so was much of the code. The tests are the claim: 78 of them, run against AEP's conformance vectors and Stripe's published field list. The UCP order receipts were also run through a verifier this repo did not write; see conformance/ucp-order-receipts.

The scorecard is a month old outside Stripe and Braintree. A re-check on 2026-11-14 flagged about a third of the source pages as changed since the 2026-11-09 snapshot, and a few as unreachable. The count moves from run to run because some sites rate limit. Those cells have not been re-read yet.

No data from any employer or customer is in here. Test values are made up or come from the public vectors.

## License

Apache-2.0. The files under test/fixtures are third party and keep their own terms: the AEP vectors (Apache-2.0, A-Comm Technologies) and a trimmed part of Stripe's OpenAPI file (MIT, Stripe). See NOTICE.
