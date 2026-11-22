Made up Stripe objects for the PaymentIntent reader tests. No real account, card or order.

agent_details and its two children (name, network_business_profile) follow Stripe's PaymentIntent reference at api version 2026-09-30.preview, read 2026-11-21:
https://docs.stripe.com/api/payment_intents/object?api-version=2026-09-30.preview

That page prints no example value for agent_details, so the values here are invented. On 2026-11-21 the field was not in Stripe's public OpenAPI files (github.com/stripe/openapi: spec3.json at 2026-09-30.endive, spec3.sdk.json at 2026-11-18.endive, spec3.beta.sdk.json at 2026-11-18.preview), so these tests cannot check the names against a machine readable file the way the evidence tests do.
