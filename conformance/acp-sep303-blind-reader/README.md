# Blind reader for ACP SEP 303 (dispute_resolution)

A second reader of `rfcs/rfc.dispute_resolution.md` at `94a71e94616e8428291cb004207a48a11e47fd95`, scored against the 33 conformance cases in agentic-commerce-protocol PR 316 (`examples/unreleased/dispute_resolution/conformance_cases.json`, sha256 `284db2ece283415ddbcbdbd523e2a8452838e914c01beca8f44a3d0a597fd3cf`).

Result: 33 of 33.

## Run it

Python 3, standard library only.

```
python3 make_inputs.py conformance_cases.json   # strips expect and note, writes inputs.json
python3 reader.py                               # reads inputs.json, writes results.json
python3 score.py conformance_cases.json         # compares results.json to the expect blocks
```

## How it was kept blind

The reader was written from the RFC, the README with its Source section cut, the dispute_resolution JSON Schema at the same commit, and the 33 case inputs with `expect` and `note` removed. It never saw the expectations. Scoring came after, with `score.py`. The scorer was checked by planting wrong answers in `results.json`; it caught them.

## Disclosure

The reader is AI-written (Claude), so it is independent of the case author, not of the model. A hand-written implementation would be the stronger row.

`readings.md` lists every spot where the RFC text was thin and which way the reader went. Two of them still matched the cases: rule 3 read per line (D4d), and an unbound approval falling to rule 5 with no finding (D8b, D8d).
