Made up Adyen objects for the reader tests. No real merchant, card or order.

Field names follow two Adyen pages, both read 2026-11-21:
https://docs.adyen.com/online-payments/agentic-commerce/merchant/agentic-cart-api-integration
https://docs.adyen.com/online-payments/agentic-commerce/merchant/google-agentic-commerce

The webhook wrapper (notificationItems, NotificationRequestItem, eventCode, success, eventDate, originalReference, additionalData) follows
https://docs.adyen.com/development-resources/webhooks/webhook-types

"openai" is one of the example shoppingPlatform values on the Cart API page. "UCP" and "Google" are the example metadata values on the Google page. Every other value is invented.

Adyen's Cart API page says the AUTHORISATION webhook carries sessionId and shoppingPlatform in additionalData, and prints no example webhook. The flat key spelling in authorisation-webhook.json is this repo's reading of that sentence, not a captured payload.
