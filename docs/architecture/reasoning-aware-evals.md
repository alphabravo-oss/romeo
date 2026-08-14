# Reasoning-aware evaluations

Eval runs accept the same strict `ReasoningPolicy` used by interactive runs. The
action-time resolver applies the deployment, organization, workspace, current
agent default, and per-request layers before quota, credential resolution, or a
provider call. A requested policy that the selected model, provider, dialect, or
governance ceiling cannot enforce fails the whole eval run; it is never silently
downgraded.

Each completed run stores only the requested and effective policy objects plus
bounded metrics. Latency uses a monotonic clock around provider work and output
policy enforcement. Token fields are provider-reported: reasoning tokens are a
subset of output tokens and are never added again when estimating cost. Cost is
available only when every case reports both input and output tokens and the
selected model has canonical pricing. Partial reporting remains explicitly
partial and produces no cost estimate.

The comparison endpoint groups runs by suite, model, requested policy, and
effective policy. Scores and latency are averages. Reported token and cost
fields are totals across the group's runs, and become `null` unless every run is
comparable. The bounded trend contains run IDs, scores, latency, and completion
times only.

Provider raw reasoning and provider-safe summaries are both excluded from eval
output and rubric input. The complete assembled answer passes through the
content-policy boundary before it is scored or persisted. Comparison responses
and audit metadata never contain prompts, outputs, raw reasoning, tool names,
credentials, upstream errors, or provider bodies.

Eval runs intentionally pin one requested model. There is no implicit provider
fallback or transport retry, because either would invalidate same-model policy
comparisons and could double-count usage. A network failure persists no run;
repeating the explicit request creates a distinct run and metric observation.
This is deliberate execution identity, not an idempotent replay claim.

Migration `0028_eval_reasoning_policy_metrics.sql` adds nullable JSONB columns,
so old rows remain readable. Restart-safe column creation plus shape and size
constraints reject malformed non-null objects at PostgreSQL, while the strict
repository mapper independently drops malformed legacy or externally written
evidence.
