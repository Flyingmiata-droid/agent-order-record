# Gateway readiness scorecard, agent placed card orders

Draft 1, read 2026-10-15. Pages change, so run scripts/recheck.ts before you lean on a cell. Re-read 2026-11-14 and still true: Stripe PaymentIntent.agent_details is on the preview API, Braintree transaction.facilitator_details is on the transaction response, and neither Dispute object lists an agent field. Re-read 2026-11-17: Stripe Radar now lists an agent attribute, is_agent_initiated, so the Stripe risk cell moved from SILENT to YES.

The question the card answers: when an AI agent places a card order through this gateway, what does the merchant get back that says so, and does that signal survive to the dispute? Every cell is read from the vendor's own docs, API reference, changelog, terms or press release on the date shown. Nothing is inferred from a marketing sentence. The rows were first gathered with AI help, then each YES or PART cell was tied to the page it came from where one could be pinned (data/scorecard.json lists 5 that still need it under source_gaps). Two cells (Stripe agent_details, Braintree facilitator_details) were re-read by hand against the live page on 2026-10-15 and matched.

Cell codes: YES = documented, field or sentence quoted below. PART = documented in part. NO = doc says it does not. SILENT = relevant doc read, nothing on it. ASK = no relevant doc found or reachable. ANN = announced only, no live product or doc.

## The card

| Gateway | Accepts agent orders | Agent field in API | Shows in reporting | Reaches disputes | Risk rules read it | Token scoped to merchant | Refund guidance |
|---|---|---|---|---|---|---|---|
| Stripe | YES (public preview; SPT, ACP, UCP) | YES PaymentIntent.agent_details | YES Dashboard tag and filter | SILENT | YES Radar is_agent_initiated | YES | YES (no change) |
| Braintree (PayPal) | YES (ACP, UCP) | YES response only, facilitator_details | YES Control Panel filter | SILENT | SILENT | YES | SILENT |
| Adyen | YES (limited, enterprise US; UCP, AP2, ACP) | PART request side, shoppingPlatform and metadata | PART webhooks only | SILENT | SILENT (custom fields possible) | YES | SILENT |
| Worldpay | YES (ACP live, UCP soon) | PART request side, paymentInstrument.type delegate | SILENT | ASK | SILENT | PART | SILENT |
| Checkout.com | YES (ACP, UCP; networks press only) | SILENT | SILENT | SILENT (blog only) | SILENT | SILENT | SILENT |
| Shopify Payments | YES (live; UCP, Shop Pay) | SILENT (channel attribution, field unnamed) | PART admin channel view | SILENT | SILENT | PART | PART (fee terms only) |
| Square | YES (live; Order by Cash App, UCP) | SILENT (OrderSource.name, value unnamed) | PART source visible | SILENT | SILENT | SILENT | SILENT |
| PayPal (wallet, Orders v2) | YES (ACP via Braintree only; UCP via Orders v2) | SILENT | SILENT | PART (Seller Protection sentence) | SILENT | SILENT | SILENT |
| Cybersource (Visa) | YES pilot, agent side only | SILENT (no merchant indicator) | SILENT | SILENT | SILENT | SILENT | SILENT |
| Nuvei | ANN (TAP pilot, H2 2026 target) | SILENT | SILENT | SILENT | ANN (KYA scoring) | SILENT | SILENT |
| Fiserv (Commerce Hub, Clover, CardPointe) | ANN (TAP, Agent Pay, early adopter program) | ASK | SILENT | SILENT | SILENT | SILENT | SILENT |
| Global Payments (Heartland, Genius) | ANN (building ACP, UCP) | ASK | SILENT | SILENT | SILENT | SILENT | SILENT |
| NMI | SILENT | SILENT | SILENT | SILENT | SILENT | SILENT | SILENT |
| Authorize.net (Visa) | ASK | SILENT | ASK | ASK | SILENT | ASK | SILENT |
| Elavon | ASK | SILENT | SILENT | SILENT | SILENT | SILENT | SILENT |
| Helcim | ASK | SILENT | SILENT | SILENT | SILENT | SILENT | SILENT |

## What the card says

Nobody passes the agent signal to the dispute. Sixteen gateways checked, zero document an agent field on the dispute object, the chargeback notice or the evidence form. Stripe's Dispute object, Braintree's Dispute object and PayPal's Customer Disputes schema were each read field by field: no agent field. For Worldpay and Authorize.net the dispute docs could not be read (ASK), so that is 14 read and 2 unknown. That is the gap this repo works on.

Two gateways give the merchant a named field. Stripe (PaymentIntent.agent_details, private preview) and Braintree (transaction.facilitator_details, response only). Both also tag it in the dashboard. Everything else is a request side hint the merchant has to store itself (Adyen shoppingPlatform, Worldpay paymentInstrument.type delegate) or a channel label with no documented value (Shopify, Square).

One fraud rule engine reads an agent signal: Stripe. Radar lists is_agent_initiated, a Boolean that is true "when Stripe identifies the payment as initiated by an AI agent" (read 2026-11-17). That is Stripe's own detection, it is not the agent_details object, and it still does not reach the dispute. Braintree Fraud Protection Advanced, Adyen custom risk fields, Checkout.com rule categories, Worldpay fraud assessment: none has an agent attribute. Adyen lets the merchant pass its own custom flag into rules, which is a workaround, not a feature.

The small merchant gateways are silent or absent. NMI, Authorize.net, Elavon, Helcim: no doc saying they accept agent orders, no field, no announcement with a date (NMI has blog posts only). These are the gateways the merchants who will get the first "my agent did it" chargebacks actually use.

## Row detail

### Stripe

Accepts: Shared Payment Tokens, public preview (private preview when first read 2026-10-15). "Shared payment tokens (SPTs) grant sellers scoped access to customers' payment methods for agent-initiated purchases. SPTs are available to agents, customers, and sellers in the US, Canada, and select European countries." https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens (undated, read 2026-11-17). Protocols UCP, https://docs.stripe.com/agentic-commerce/protocols/ucp, and ACP, https://docs.stripe.com/agentic-commerce/protocols/acp. The same SPT page says Stripe may use Mastercard Agent Pay, Visa Intelligent Commerce and American Express ACE Kit tokens on the seller's behalf (the old sellers/custom page now redirects there).

API field: PaymentIntent.agent_details (object, nullable), with agent_details.name and agent_details.network_business_profile. https://docs.stripe.com/api/payment_intents/object?api-version=2026-09-30.preview. Listed as "Agent details (Private preview)" at CheckoutSessions.PaymentIntent.agent_details on https://docs.stripe.com/agentic-commerce/sellers/use-cases/retail/checkout (re-read by hand 2026-11-15; the field table moved there from the retail overview page). SharedPaymentGrantedToken carries agent_details, usage_limits and risk_details.insights (bot, card_testing, stolen_card, fraudulent_dispute, card_issuer_decline), https://docs.stripe.com/api/shared-payment/granted-token/object.

Reporting: "View orders on the Transactions page in the Dashboard, where they're tagged with the originating agent. You can also filter transactions by agent names." https://docs.stripe.com/agentic-commerce/sellers/use-cases/retail/checkout (re-read by hand 2026-11-15).

Disputes: Dispute object has no agent field, https://docs.stripe.com/api/disputes/object. The Handle orders page says "Manage refunds and disputes on the Transactions page" and points dispute responses to the general dispute guide, https://docs.stripe.com/agentic-commerce/sellers/use-cases/retail/checkout/orders (undated, read 2026-11-15). Agent Services terms (modified 2026-04-20): "an Agentic Seller is solely responsible for Agentic Customers' claims relating to Agentic Seller's goods and services," https://stripe.com/legal/ssa-service-terms.

Risk rules: Radar supported attributes list is_agent_initiated (Boolean), "True when Stripe identifies the payment as initiated by an AI agent," under Cards, other payment details, https://docs.stripe.com/radar/rules/supported-attributes (undated, read 2026-11-17). The 2026-10-15 read found no agent attribute there.

Token scope: "The agent grants SPTs to your Stripe profile, each with usage and expiration limits" (usage_limits: currency, max_amount, expires_at), https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens (undated, read 2026-11-17).

Refunds: "your existing refund flow works without changes for agentic checkouts," https://docs.stripe.com/agentic-commerce/sellers/use-cases/retail/checkout/orders (undated, read 2026-11-17; the old sellers/manage page now redirects elsewhere).

### Braintree (PayPal)

Accepts: Agent Ready, ACP via delegated payment tokens, UCP via the Google Pay handler. https://docs.paypal.ai/growth/agentic-commerce/agent-ready/overview (undated, read 2026-10-15).

API field: transaction.facilitator_details.oauth_application_name ("ChatGPT") and oauth_application_client_id in the transaction response. https://developer.paypal.com/agent-ready/agentic-commerce-protocol (re-read by hand 2026-10-15). Reference: https://developer.paypal.com/braintree/docs/reference/response/transaction. UCP path: no agent field documented.

Reporting: "Use the search filter for facilitator_details.oauth_application_name" in the Control Panel; GraphQL search on facilitatorOAuthApplicationClientId.

Disputes: Dispute object has no facilitator field, https://developer.paypal.com/braintree/docs/reference/response/dispute.

Risk rules: Fraud Protection Advanced lists custom fields and predefined features, none named facilitator or agent, https://developer.paypal.com/braintree/articles/guides/fraud-tools/premium/fraud-protection-advanced.

Token scope: "It's bound to your merchant ID and includes amount and time restrictions that you can configure." Validation errors 91565, 915266, 915267. UCP nonce single use, 3 hour expiry.

Refunds: silent.

### Adyen

Accepts: "Adyen Agentic is in limited availability for enterprise merchants operating in the U.S." UCP, AP2, ACP. https://www.adyen.com/press-and-media/adyen-agentic (2026-06-16). Docs: https://docs.adyen.com/online-payments/agentic-commerce (the old agentic-checkout-integration page returned 404 on 2026-11-17).

API field: Agentic Cart API shoppingPlatform ("Agent platform identifier, for example, openai, google, meta"), https://docs.adyen.com/online-payments/agentic-commerce/merchant/agentic-cart-api-integration (modified 2025-12-23). UCP path: optional metadata.agentProtocol, agentSessionId, agentPlatform, https://docs.adyen.com/online-payments/agentic-commerce/merchant/google-agentic-commerce (modified 2026-10-15). No agent flag in the /payments response.

Reporting: AUTHORISATION webhook carries sessionId and shoppingPlatform in additionalData; additionalData.agentic.sessionId. Customer Area and reports: silent.

Disputes: silent on every page read. UCP PAN_ONLY: "Liability shift is not available."

Risk rules: no Adyen agent field; merchant can pass its own additionalData.riskdata.<name> into custom rules, https://docs.adyen.com/risk-management/configure-manual-risk/configure-custom-risk-rules (moved, read 2026-11-17).

Token scope: ACP delegate_payment allowance (merchant_id, checkout_session_id, max_amount, currency, expires_at, one_time), token "bound to one merchant account," https://docs.adyen.com/online-payments/agentic-commerce/agent-platform/agentic-payments-acp (modified 2026-03-06).

Refunds: silent.

### Worldpay

Accepts: ACP live. Release note 2026-02-18: "Delegate tokens are now supported. Used as part of the Agentic Commerce Protocol (ACP) flow." https://docs.worldpay.com/access/products/releases. "We are an approved payment partner for OpenAI's Instant Checkout," https://docs.worldpay.com/access/products/ai/acp. UCP and agentic tokens: coming soon.

API field: request side, instruction.paymentInstrument.type "delegate" with sessionHref, https://docs.worldpay.com/access/products/payments/enable-features/acp-delegate-token (updated 2026-10-09). Delegate token allowance and risk_signals at https://docs.worldpay.com/access/products/sessions/openapi/delegate-payment/delegatepayment.md. Response side: payment response schema has no delegate or agent term.

Reporting: query payments page gives no field detail. Silent.

Disputes: disputes doc did not load; ACP pages say nothing. ASK.

Risk rules: fraud assessment page has no agent condition. Delegate flow: "3DS, SCA exemptions, and Worldpay token creation are not available."

Token scope: allowance.merchant_id required, reason one_time; "We validate the payment allowances specified by OpenAI before processing the payment." Merchant sees no scope data in the response.

Refunds: silent.

### Checkout.com

Accepts: ACP (press 2025-11-25, https://www.checkout.com/newsroom/checkout-adopts-acp-backed-by-openai-to-power-agentic-commerce-for-enterprise-merchants) and UCP, docs https://www.checkout.com/docs/payments/accept-payments/accept-a-payment-via-agentic-commerce. Visa and Mastercard programs: blog only.

API field: token arrives with provider "checkout", managed_by "agentic_platform_psp"; merchant sends source.type token, merchant_initiated false. No agent indicator field, https://www.checkout.com/docs/payments/accept-payments/accept-a-payment-via-agentic-commerce/accept-a-payment-via-chatgpt (updated 2026-09-09).

Reporting, risk rules (https://www.checkout.com/docs/risk-management/fraud-detection/rule-categories, 2026-05-13), token scope, refunds: silent.

Disputes: blog only, "Checkout.com can provide issuers with the original consent record," https://www.checkout.com/blog/how-checkout-is-thinking-about-agentic-commerce (2025-09-02). Nothing in docs.

### Shopify Payments

Accepts: live. "Starting this week, millions of merchants can sell to ChatGPT users via Agentic Storefronts," https://www.shopify.com/news/agentic-commerce-momentum (2026-03-24). UCP spec 2026-08-25, Shop Pay handler.

API field: "Orders from AI channels display in your Shopify admin with channel or referrer attribution so that you know where the order originated from," https://help.shopify.com/en/manual/online-sales-channels/agentic-storefronts. No Admin API field named. Staff on https://community.shopify.dev/t/ai-agent-initiated-orders-api/29140 (2026-02-06): agents "will be treated as unique sales channels," no field given.

Reporting: Agentic Storefronts admin page, https://shopify.dev/changelog/a-new-home-for-agentic-storefronts-in-your-admin (2026-05-11).

Disputes: Supplemental Terms (last updated 2026-10-06, read 2026-11-17) still silent on chargebacks; "You remain the seller of record," https://www.shopify.com/legal/terms-agentic-storefronts (the old address now returns 404).

Risk rules: silent.

Token scope: Shop Tokens single use, checkout scoped (Path A) or buyer and platform scoped (Path B), https://shopify.dev/docs/agents/carts-and-checkout/shop-pay-handler. Not scoped to one agent.

Refunds: fee terms only (6.1).

### Square

Accepts: live for US food and beverage sellers with Square Online Ordering. "Eligible sellers are opted in with no additional work, setup, or fees required," https://squareup.com/us/en/press/claude-chatgpt-integrations (2026-07-01). Ask Maps via Order by Cash App, https://squareup.com/us/en/press/ask-maps (2026-08-06).

API field: OrderSource.name only, no agent value documented, https://developer.squareup.com/reference/square/objects/OrderSource.

Reporting: "The source of the order is visible in Square's reporting" (press 2026-07-01); orders "tagged by source," Dashboard > Online Channels > AI assistants, https://squareup.com/us/en/ai/agentic-commerce.

Disputes, risk rules, token scope, refunds: silent. "Agentic orders are routed through the same Square systems as any online order."

### PayPal (wallet and Orders v2, not Braintree)

Accepts: ACP guide "walks you through configuring Braintree as your payment provider," https://developer.paypal.com/agent-ready/agentic-commerce-protocol. Orders v2 path is UCP with PayPal (Google Pay credential), https://developer.paypal.com/agent-ready/overview.

API field: Orders v2 schema has no agentic or facilitator field; stored_credential.payment_initiator is CUSTOMER or MERCHANT only, https://developer.paypal.com/api/orders/v2/schema.json.

Reporting: Payments v2 and Customer Disputes v1 schemas have no agent field.

Disputes: "Seller and Purchase Protection, fraud tools, chargeback coverage, and identity services now extend to agentic transactions," https://paypal.ai/agent-ready. Footnote limits Seller Protection to unauthorized and item not received. Nothing on the indicator reaching the dispute.

Merchant-set marker (added 2026-11-11, from a GitHub comment on paypal/agent-toolkit 113, checked against the schema): a merchant can put its own agent marker in purchase_units[].custom_id or a capture's invoice_id, and the Disputes v1 dispute object returns disputed_transactions[] as transaction_info with custom (free text, max 2000) and invoice_number (max 127, pattern A-Z a-z 0-9 : - |). Neither field is listed as required, so the schema does not promise they come back. https://developer.paypal.com/api/customer-disputes/v1/schema.json (read 2026-11-11). This is a merchant workaround, not a PayPal agent field, so the SILENT cells stand.

Risk rules, token scope, refunds: silent.

### Cybersource (Visa Acceptance)

Accepts: Intelligent Commerce REST guide, pilot (revision 25.09.01). Agent side API: /acp/v1/tokens, /instructions, /credentials, /confirmations. https://developer.cas.cybersource.com/docs/cybs/en-us/visa-agentic-platform/developer/all/rest/intelligent-commerce.html. Not a merchant side flag on the Payments API.

API field: nearest are assuranceData[].verificationType and paymentOptions.dynamicDataType ("TAVV"). No agent identity field. Payments API field index and release notes 2026-07-02 to 2026-08-28: no agent field.

Reporting, disputes (only an undefined products[].policies.disputePolicy), risk rules (agent side mandates[].declineThreshold only), token scope, refunds: silent.

### Nuvei

Accepts: announced. TAP support and Agent Enabler pilot (2025-10-14); live proof of concept with Visa, "targeting initial availability in the second half of 2026," https://www.nuvei.com/posts/nuvei-completes-first-party-in-agent-payment-with-visa-unveils-merchant-led-agentic-payments-strategy (2026-07-02).

API field: REST reference and release notes through 26.S10 (2026-10-13) have no agent entry, https://docs.nuvei.com/api/main/indexMain_v1_0.html.

Risk rules: "the KYA registry and agent risk scoring" announced for H2 2026. Everything else silent.

### Fiserv (Commerce Hub, Clover, CardPointe)

Accepts: announced. "Fiserv will deploy Visa's Trusted Agent Protocol" and Mastercard Agent Pay Acceptance Framework (Business Wire 2025-12-22). Sales sheet lists ACP, AP2, TAP, Agent Pay and an early adopter program. No live date.

API field: developer.fiserv.com and developer.cardpointe.com searches found nothing; Commerce Hub docs did not render. ASK.

Reporting: "Use existing merchant accounts for consolidated settlement and reporting, just as you are used to" (sales sheet). Everything else silent.

### Global Payments (Heartland, Genius)

Accepts: "We're building support for emerging standards, including OpenAI's ACP and Google's UCP," https://www.globalpayments.com/agentic-commerce. Worldpay (acquired 2026-01-12) is the only GP platform with agentic docs. Nothing for Heartland.

Reporting: "See who, or what, is behind every transaction, with visibility into agent identity, permissions and bot activity" (same page, no screen or field named). Everything else silent or ASK.

### NMI

No doc says NMI accepts agent placed orders or names a protocol. Blogs only: https://www.nmi.com/blog/human-not-present-agentic-commerce-network-tokens-and-payments/ (2026-07-15), https://www.nmi.com/blog/prediction-network-tokens-will-take-center-stage-while-agentic-commerce-tests-the-industry/ (2026-07-14). The only agent named item is the optional NMI_AGENT_ID variable on NMI's own MCP server ("Fixed name for the calling assistant"), https://docs.nmi.com/docs/mcp-api (undated, read 2026-11-17). All seven cells silent. NMI is the gateway that published the five questions every merchant should ask on its own blog (2026-09-28, link not pinned here); it has not answered them for itself.

### Authorize.net (Visa)

No page says it accepts agent placed orders. API reference has no agent field (nearest: authorizationIndicator, deprecated authenticationIndicator), https://developer.authorize.net/api/reference/index.html. API change log last entry 2019-09-03. Visa's 2026-04-08 Intelligent Commerce Connect release does not name Authorize.net.

### Elavon

No announcement in 30 company news items (2022 to 2026-09-29). Elavon Payment Gateway OpenAPI spec (version 2026-07-21): zero hits for agentic, Agent Pay, Intelligent Commerce, Trusted Agent; credential on file enums are subscription, unscheduledCardholderInitiated, unscheduledMerchantInitiated. https://developer.elavon.com/products/elavon-payment-gateway/v1/api-reference.

### Helcim

No announcement (2025 and 2026 list, latest 2026-09-08). 150 devdocs pages read; purchase endpoint (updated 2026-04-20) has no agent, channel or initiator field, https://devdocs.helcim.com/reference/purchase. Changelog latest 2026-07-30.

## Limits

First read in one day, 2026-10-15. Later re-reads carry their own date in the row. Docs behind JavaScript shells (Fiserv Commerce Hub, Elavon Converge, Global Payments developer portal) could not be read, so those ASK cells may hide a field. Private preview and limited availability docs can change without a changelog entry. A SILENT cell means the pages named above say nothing; it does not mean the vendor has nothing. A written answer from a vendor replaces the cell with a dated "stated" value.
