# Rewrite preservation regressions

`demo.json` records the quick demo's source, required facts, known forbidden
additions, allowed edits, and contrasting outputs. Run `node scripts/rewrite-demo.test.js`.
The check reads the published README pair, so fixture-only correctness cannot
hide a regression in the example readers see.

These explicit patterns catch the original investor/integration inventions and
missing dashboards. They accept more than one rewrite, but can reject an
unlisted paraphrase or accept a negated, contradictory, or newly invented claim.
They do not prove semantic fidelity. Human review remains necessary.

## Published example audit

Reviewed at main `d57265d` for issue #200:

- Quick demo: removed an unsupported investor and integration mechanism; restored
  real-time dashboards.
- Full README example: retained its supported investor list and product
  capabilities; removed invented resolution times, Datadog attribution, paying
  customer count, EMEA hiring and log-management plans. Preserved the supplied
  go-to-market plan and adoption claim. Explicitly flagged the unnamed market
  and study sources instead of silently replacing their figures.
- README catalog rows 1, 2, 4, 5 and 7: replaced example-specific inventions with
  editing guidance. Other rows describe transformations or use placeholders;
  they are illustrative directions, not verified factual source/output pairs.
- `examples/prose.json` and `examples/technical.json` are style configurations,
  not rewrite pairs. The catalog's embedded rule examples remain outside this
  published-demo audit; this review does not certify every rule in the skill.

The examples are fictional. No real-world funding or product claim is verified
by these fixtures. Wider editing evaluation is tracked in #201.
