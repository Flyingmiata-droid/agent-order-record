# Fixtures

Third party files. Do not edit them. The AEP files are byte for byte; the Stripe file is a trimmed copy.

- aep/: conformance vectors a, b, h and the test key from github.com/A-Comm-Tech/a-comm-evidence-protocol, vectors/v1.0.3-rc.2, Apache-2.0. Fetched 2026-11-09. The product name in these vectors holds non ASCII characters on purpose (the NFC test).
- stripe/evidence-param.json: trimmed from github.com/stripe/openapi, openapi/spec3.json, MIT. API version 2026-09-30.endive, fetched 2026-11-09. Holds the evidence parameter of POST /v1/disputes/{dispute} and the list of file fields on the dispute_evidence object.
- stripe/LICENSE: the MIT license text from github.com/stripe/openapi, for the trimmed file above.
