An AI agent buys something with a card. A month later the cardholder says "I never ordered that." What does the merchant have to show?

Mostly nothing a card dispute form can take. The evidence formats for agent orders (AEP and a few others) stop at "export a bundle". This repo works on the step after that: what each gateway can carry, in which field, and what the bundle turns into when you file the dispute.

It does not define a new evidence format. It reads an AEP DisputeBundle.

This is a prototype. It has not been run against a Stripe account, live or test. Nothing here sends, submits or decides a dispute.

## What this is not

It does not capture anything at checkout. Hosted services already do that part. Evidora records the step where a person sets up the agent, and Chargeflow fights chargebacks for merchants. If you want that, use one of them. This repo is the free part next to them: what each gateway carries, read from its own docs and dated, plus code that turns a bundle into dispute fields.

## What is here

A gateway scorecard, as data. SCORECARD.md is the readable copy and data/scorecard.json is the same thing for code: 16 gateways, 7 questions each. A YES or PART cell quotes the vendor page it came from, with the date. Six of them still need the exact page pinned and are listed under source_gaps. For SILENT and ASK cells, the row detail in SCORECARD.md names the pages that were read. The questions are plain ones. Does the gateway accept agent orders? Does the merchant get an agent field in the API? Does it show in reporting? Does it reach the dispute? Do risk rules read it? Is the token scoped to one merchant? Is there refund guidance?

A re-check script. scripts/recheck.ts fetches every source page again, hashes the text and lists the cells that lean on a page that changed. It never edits a cell. A person re-reads the page.

An AEP chain check. src/aep.ts and src/jcs.ts do canonical JSON, the SHA-256 chain and Ed25519 signatures. They pass AEP conformance vectors a, b and h byte for byte.

A Stripe evidence renderer. src/stripe.ts takes a DisputeBundle and returns the ten text fields for Stripe dispute evidence, plus page text for the three file fields. It refuses a bundle whose verification failed, is cached or contradicts itself, an empty bundle, a chain whose hashes no longer match (unless you pass reverify: false, which gives a warning instead), and any output that looks like it holds a card number. Signatures are checked again only when you pass the public key. Without the key you get a warning, not a refusal.

A Visa CE 3.0 check. src/ce3.ts takes the disputed order and the prior orders and answers yes or no, with the reason. Device and IP values count only when they belong to the cardholder. On an agent order they often belong to the AI platform, and then they say nothing about the buyer.

## Run it

Node 22.18 or newer. No install step and no packages.

    node --test "test/*.test.ts"
    node examples/stripe-evidence.ts
    node scripts/recheck.ts

The example takes AEP's own test vector b, checks the chain, and prints the Stripe evidence fields a merchant would end up with. The product name in that vector has accents and a long dash on purpose. It is AEP's text encoding test.

## What the scorecard says so far

Read 2026-10-15. The Stripe and Braintree cells below were read again on 2026-11-14.

Two of the 16 gateways give the merchant a named field for the agent: Stripe (PaymentIntent.agent_details, preview API) and Braintree (transaction.facilitator_details, a general third party field that its ACP page fills with ChatGPT). None documents an agent field on the dispute object or the evidence form: 14 were read and none has one (PayPal only says its Seller Protection extends to agentic transactions), and for 2 (Worldpay, Authorize.net) the dispute docs could not be read. One fraud rule engine documents an agent attribute: Stripe Radar's is_agent_initiated, Stripe's own detection, found on a re-read 2026-11-17. NMI, Authorize.net, Elavon and Helcim have no doc saying they accept agent orders (NMI has blog posts only).

So today the agent signal dies between the payment and the dispute.

If a cell is wrong or out of date, open an issue with the link and the date you read it. That is the most useful thing anyone can send.

## What is not built

No PDF output. The three file fields come out as text and you make the PDF.

No call to Stripe.

The Stripe renderer does not fill the Visa CE 3.0 block yet. The check exists, but the renderer does not call it.

No Braintree, Adyen or PayPal renderer, and no readers that pull the agent field off a gateway object.

sealedBundleHash is not checked. AEP has not pinned the bundle signature rule yet (its vector c is pending). Until then a chain cut short at the end, with its verification block edited to match, is not caught.

Bad input types (a number where text belongs, a missing block) throw a plain error, not a clean refusal.

## One thing found while building

AEP Appendix C gives one text limit for Stripe, about 150,000 characters combined. That is right. But Stripe also caps each field: 20,000 on the long text fields (product_description, access_activity_log, uncategorized_text) and 5,000 on the short ones. Read 2026-11-09 in Stripe's OpenAPI file, API version 2026-09-30.endive. The renderer cuts each field to its own cap on a word boundary. That same API version also rejects evidence over the card network's page limit (error dispute_evidence_page_limit_exceeded, Stripe changelog 2026-09-30.endive). The renderer does not estimate pages yet.

## Where the facts come from

Every scorecard cell comes from a vendor's own docs, API reference, changelog, terms or press release. A SILENT cell means the pages named say nothing. It does not mean the vendor has nothing.

The first pass over the rows was done with AI help, and so was much of the code. The tests are the claim: 38 of them, run against AEP's conformance vectors and Stripe's published field list.

The scorecard is a month old outside Stripe and Braintree. A re-check on 2026-11-14 flagged about a third of the source pages as changed since the 2026-11-09 snapshot, and a few as unreachable. The count moves from run to run because some sites rate limit. Those cells have not been re-read yet.

No data from any employer or customer is in here. Test values are made up or come from the public vectors.

## License

Apache-2.0. The files under test/fixtures are third party and keep their own terms: the AEP vectors (Apache-2.0, A-Comm Technologies) and a trimmed part of Stripe's OpenAPI file (MIT, Stripe). See NOTICE.
