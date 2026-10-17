# Romeo Monitoring Examples

Romeo exposes metadata-only operational summaries for provider resilience, background job lag, and dead-lettered jobs. The examples in this directory turn those summaries into Prometheus-compatible metrics and alerts without exposing provider endpoints, prompts, job payloads, connector bodies, tokens, or raw provider errors.

Run a one-shot scrape for node-exporter textfile collectors, cron checks, or local validation:

```sh
ROMEO_BASE_URL=https://romeo.example.com \
ROMEO_API_KEY="$ROMEO_API_KEY" \
pnpm monitoring:export -- --output /var/lib/node_exporter/textfile_collector/romeo.prom
```

Run the exporter as a small HTTP service for Prometheus scraping:

```sh
ROMEO_BASE_URL=https://romeo.example.com \
ROMEO_API_KEY="$ROMEO_API_KEY" \
pnpm monitoring:export -- --listen 0.0.0.0:9464
```

For Docker Compose installs, the `monitoring` profile runs the same exporter on port `9464`:

```sh
ROMEO_API_KEY="$ROMEO_API_KEY" docker compose -f deploy/compose/compose.yml --profile monitoring up operational-monitoring-exporter
```

Use `operational-exporter.deployment.example.yaml` as the Kubernetes starting point. It expects a scoped monitoring API key in `romeo-monitoring-api-key` and serves `/metrics` on port `9464`. `/health` is process liveness only; `/ready` performs a bounded authenticated read of both operational-summary sources and fails closed with `503` when either source is unavailable. Prometheus Operator users can apply `prometheus-rules.yaml`; plain Prometheus users can copy `spec.groups` into their rule files.

The rule file includes provider, background-job queue, dead-letter, and Postgres backup alerts. `RomeoPostgresBackupJobFailed` uses kube-state-metrics `kube_job_status_failed`. Managed backup Jobs exit successfully only after dump, manifest, and status readback verification, so `romeo_postgres_backup_last_success_timestamp_seconds`, `romeo_postgres_backup_age_seconds`, and `RomeoPostgresBackupMissingOrStale` expose the last verified success and alert when it is absent or older than 36 hours. Kubernetes installs must scrape kube-state-metrics for this evidence. Externally managed backup mode must provide equivalent platform-native last-success, age, failure, and restore-test alert evidence referenced by the Helm values.

Run-stream monitoring also exports active streams, reconnect replay rows,
cursor-query counts and rows, notifier lag/fallback, bounded-buffer high-water,
slow-consumer drops, heartbeat failures, and terminal-close latency. These
transport observations carry only counts, byte totals, timings, and the fixed
`scope="process"` label; they never include run, chat, user, event, or content
identifiers. They use a rolling 15-minute in-process window and reset on
process restart. Fleet dashboards should aggregate every Romeo API replica and
retain the existing durable `romeo_sse_reconnect_total` and
`romeo_sse_disconnect_total` summaries for cross-process trend evidence.

The example rules warn when notification delivery falls back to cursor
polling, notifier p95 lag exceeds one second, a slow consumer is dropped, a
heartbeat enqueue fails, or terminal close p95 exceeds one second. A single
fallback or drop is not evidence of lost events: PostgreSQL cursor replay
remains authoritative.

Validate the exporter and alert contract with:

```sh
pnpm validate:operational-monitoring -- --output dist/ci/operational-monitoring-validation.json
```

This validation parses the example manifests, renders synthetic provider/job summaries into Prometheus text, checks alert expressions against real metric names, and proves raw sentinel fields are not emitted.
