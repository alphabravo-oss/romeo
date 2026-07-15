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

Use `operational-exporter.deployment.example.yaml` as the Kubernetes starting point. It expects a scoped monitoring API key in `romeo-monitoring-api-key` and serves `/metrics` on port `9464`. Prometheus Operator users can apply `prometheus-rules.yaml`; plain Prometheus users can copy `spec.groups` into their rule files.

The rule file includes provider, background-job queue, dead-letter, and Postgres backup job alerts. `RomeoPostgresBackupJobFailed` uses kube-state-metrics `kube_job_status_failed`, so Kubernetes installs must scrape kube-state-metrics for backup alert evidence.

Validate the exporter and alert contract with:

```sh
pnpm validate:operational-monitoring -- --output dist/ci/operational-monitoring-validation.json
```

This validation parses the example manifests, renders synthetic provider/job summaries into Prometheus text, checks alert expressions against real metric names, and proves raw sentinel fields are not emitted.

After forcing the selected provider, queue-lag, dead-letter, and backup-failure drills in the live monitoring stack, collect GA alert-firing evidence with:

```sh
PROMETHEUS_URL="https://prometheus.example.com" \
PROMETHEUS_BEARER_TOKEN="$PROMETHEUS_BEARER_TOKEN" \
ALERTMANAGER_URL="https://alertmanager.example.com" \
ALERTMANAGER_BEARER_TOKEN="$ALERTMANAGER_BEARER_TOKEN" \
pnpm smoke:alerts:live -- --output dist/ci/live-alert-firing.json
```

Omit `ALERTMANAGER_URL` only when the target monitoring stack does not use Alertmanager. Dry-run output is planning evidence only and is rejected by the GA checklist.
