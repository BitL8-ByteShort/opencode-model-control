# Benchmark methodology

OpenCode Model Control starts with provisional assignments. A display label, model name, or successful anecdote is not enough to call a model “best.” Promotion requires repeatable evidence under this methodology.

## Goals

The benchmark answers four narrower questions:

1. Does the router select a cost-policy-eligible model for the task and modality?
2. Does the assigned model complete that role's representative work correctly?
3. What latency, failure, and retry cost accompanies that quality?
4. Does the proposed team outperform a documented direct-model baseline without violating its recorded cost policy or modality constraints?

It does not establish universal model quality or predict future provider behavior.

## Version every run

Record, in machine-readable form:

- Methodology and fixture version.
- Git commit.
- Date, time zone, operating system, and architecture.
- Exact OpenCode version.
- Provider-qualified model IDs and reported model metadata.
- Relevant role settings, prompts, delegation limits, and randomness controls.
- Cost preference, cost policy, and pricing-evidence source.
- Number of repetitions, timeout, retry policy, and concurrency.
- Provider errors, unavailable models, rate limits, and malformed responses.

Provider access and pricing are volatile. Results apply only to the recorded model/provider combination, cost policy, and time window.

## Corpus

Use a versioned corpus that contains:

- Text-only implementation tasks with executable acceptance tests.
- Debugging tasks with a known root cause and distractors.
- Review tasks with seeded correctness, security, and regression defects.
- General synthesis tasks with explicit source and factuality criteria.
- Image-understanding tasks where the answer depends on visual content.
- Negative modality cases where no image is present or the media is unreadable.
- Ambiguous tasks where the correct action is to ask a question or avoid delegation.
- Failure cases for unavailable, disabled, and rate-limited models.

Keep hidden evaluation labels separate from routing input. Remove secrets, personal data, copyrighted private corpora, and customer material.

## Procedure

1. Freeze the corpus, catalog snapshot, settings, and evaluator before the run.
2. Randomize case order while recording the seed.
3. Run each model/role pair multiple times under the same limits.
4. Run direct-model and routed-team baselines over the same cases.
5. Preserve every failure and timeout; do not rerun only failed cases until they pass.
6. Score deterministic checks automatically and blind human review to model identity where judgment is necessary.
7. Publish raw redacted results, evaluator decisions, and aggregation code with the summary.

## Metrics

Report at least:

- Route eligibility accuracy and modality-safety violations.
- Task pass rate and critical-defect rate.
- Unsupported claims or fabricated test evidence.
- Median and 95th-percentile time to first response and end-to-end latency.
- Timeout, transport-error, malformed-response, and rate-limit rates.
- Delegation count, fallback count, and depth-limit violations.
- Input/output token counts when the provider reports them.
- Human-review agreement and adjudication count.

Do not collapse quality, safety, latency, and reliability into one unexplained score. If a composite is useful for display, publish its formula and the underlying metrics beside it.

## Promotion gate

A role assignment can move from provisional to qualified only when:

- The exact model is still available and its pricing class is supported by current evidence.
- A verified-free qualification is promoted only from a run where exact zero pricing was independently established.
- It passes all hard modality and safety constraints.
- Its confidence interval and sample size are published.
- It meets the role's predeclared quality and critical-failure thresholds.
- It does not materially regress the documented latency and reliability budget.
- The run is reproducible from committed fixtures and instructions.

No benchmark has been promoted merely by adding this methodology. Until a qualifying run is published, the UI and docs must continue to say provisional, capability-only, or unverified.

## Anti-gaming rules

Do not tune prompts on hidden evaluation answers, remove failures after seeing results, compare different task sets, change timeouts for favored models, or select only the best run. Disclose exclusions before scoring and report sensitivity to any evaluator or threshold change.
