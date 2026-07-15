# Romeo Deployment Sizing

This guide defines initial sizing math for Docker Compose and Kubernetes deployments. These are planning defaults, not performance guarantees. A deployment tier is only accepted after the matching smoke, load, restore, and log-redaction evidence exists.

## Current Runtime Knobs

- `POSTGRES_POOL_MAX` caps the app process Postgres pool. The default is `10`.
- `MODEL_PROVIDER_STREAM_TIMEOUT_MS` bounds idle model-provider streams. The default is `60000`; active streams reset the timer on each chunk.
- `MODEL_PROVIDER_RETRY_ATTEMPTS` controls pre-output provider stream retries. The default is `1`; set `0` to disable runtime provider retries.
- `MODEL_PROVIDER_RETRY_BACKOFF_MS` controls the fixed delay before a retry. The default is `250`.
- `MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD` opens the provider circuit after consecutive retryable failures. The default is `5`; set `0` to disable circuit breaking.
- `MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS` controls when an open provider circuit can move to a probe attempt. The default is `60000`.
- `MODEL_PROVIDER_DISABLED_IDS` kill-switches one or more provider IDs. The default is empty.
- `MODEL_PROVIDER_FALLBACK_MODEL_ID` points at an existing enabled fallback model. The default is empty, which disables fallback routing.
- Kubernetes app replicas are controlled by `replicaCount` when HPA is disabled, or by `autoscaling.minReplicas` / `autoscaling.maxReplicas` when HPA is enabled.
- Worker CronJobs call the Romeo API with `ROMEO_BASE_URL` and `ROMEO_API_KEY`; they do not open Romeo repository pools directly.
- The optional KEDA webhook-retry ScaledJob uses the KEDA PostgreSQL scaler to query due webhook retry work. Reserve database connection headroom for KEDA scaler queries separately from app pods.
- Migration, seed, validation, backup, restore, and DR drill commands are short-lived maintenance paths. Run them in controlled windows and reserve database headroom while they run.

## Connection Budget Formula

Start from the database's configured `max_connections`, then reserve operational headroom before assigning app replicas:

```text
usable_connections =
  floor(max_connections * 0.80)
  - provider_reserved_connections
  - database_admin_headroom
  - maintenance_job_headroom
  - scaler_headroom

app_connection_budget =
  app_max_replicas * POSTGRES_POOL_MAX

app_connection_budget must be <= usable_connections
```

Default headroom values until load evidence proves a better number:

| Headroom item                   |                            Default | Notes                                                                                                                 |
| ------------------------------- | ---------------------------------: | --------------------------------------------------------------------------------------------------------------------- |
| `provider_reserved_connections` |                  provider-specific | Use the managed provider or CloudNativePG setting; do not assume every configured connection is available to the app. |
| `database_admin_headroom`       |                                  5 | Keeps room for admin sessions, emergency inspection, and operator activity.                                           |
| `maintenance_job_headroom`      |                                 15 | Covers migration, schema validation, backup, restore, and DR drill overlap. Increase during parallel restore drills.  |
| `scaler_headroom`               | active PostgreSQL scaler count + 2 | Covers optional KEDA PostgreSQL scaler queries and small bursts. Use `0` when no PostgreSQL scalers are installed.    |

If the formula fails, reduce `POSTGRES_POOL_MAX`, lower `autoscaling.maxReplicas`, raise database connection capacity, or add a reviewed pooler/proxy layer before increasing traffic.

## Initial Tier Targets

| Tier                   | Deployment shape                                                           | App scaling                                                      | Database floor                                                             | Worker posture                                                              | Evidence required before calling it supported                                                                                                        |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Compose          | Single-machine Docker Compose                                              | 1 app process, `POSTGRES_POOL_MAX=10`                            | Bundled pgvector Postgres                                                  | Optional loop workers by profile, one instance per class                    | `pnpm smoke:compose`, `pnpm smoke:compose:workers`, backup/restore smoke                                                                             |
| Small self-hosted      | Compose or Kubernetes with external dependencies                           | 1-2 app processes, HPA off or max 2                              | At least 50 usable app/maintenance connections after provider reserves     | CronJobs or Compose loops, no KEDA required                                 | Compose external-Postgres smoke or Kubernetes live smoke, restore validation, log redaction                                                          |
| Enterprise self-hosted | Kubernetes with external Postgres or CloudNativePG                         | HPA min 2, max 6 initially, `POSTGRES_POOL_MAX` sized by formula | At least 120 usable app/maintenance/scaler connections after reserves      | CronJobs by default; optional KEDA webhook retry after live scaler evidence | Helm render smoke, live Kubernetes smoke, Kubernetes worker smoke, CloudNativePG or hosted Postgres validation, NetworkPolicy/CNI evidence, DR drill |
| Hosted/SaaS            | Kubernetes per environment with managed database and registry release path | HPA min 3+, max based on load evidence and pooler design         | Provider-specific; pooler/proxy review required before high replica counts | Dedicated worker classes with queue-lag alerts and per-class limits         | Load/soak results, query-plan review, release readback, tenant isolation tests, failure drills                                                       |

## Worker Concurrency Defaults

- Keep CronJob `concurrencyPolicy: Forbid` for workers that can duplicate side effects.
- Keep one-shot worker limits low by default: connector sync max connectors `10`, workflow resume max workflows `10`, workflow resume max runs `10`, knowledge extraction max sources `10`, and KEDA webhook retry max replicas `3`.
- Increase worker concurrency only after the worker has idempotency evidence, provider rate-limit handling, retry/backoff behavior, and log-redaction evidence.
- Do not enable both the webhook retry CronJob and the KEDA webhook retry ScaledJob in the same namespace.
- Tool-dispatch and browser-automation workers should be sized independently from app pods, with low one-shot/CronJob concurrency until live queue-lag, crash-reclaim, egress, and log-redaction evidence exists for the target environment.

## Validation Checklist

Before promoting a tier:

- Recompute the connection budget using the exact database `max_connections`, provider reserves, `POSTGRES_POOL_MAX`, and app max replicas.
- Confirm `MODEL_PROVIDER_STREAM_TIMEOUT_MS`, `MODEL_PROVIDER_RETRY_ATTEMPTS`, `MODEL_PROVIDER_RETRY_BACKOFF_MS`, `MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD`, `MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS`, `MODEL_PROVIDER_DISABLED_IDS`, and `MODEL_PROVIDER_FALLBACK_MODEL_ID` match provider latency, quotas, alerting, fallback policy, kill-switch policy, and tenant-facing timeout behavior for the target tier.
- Generate synthetic fixtures with `pnpm fixtures:scale -- --tier local|small|enterprise --output dist/scale/scale-fixtures.json --report-output dist/scale/scale-fixture-report.json`.
- Run `pnpm smoke:scale:load -- --dry-run --fixture-file dist/scale/scale-fixtures.json --output dist/scale/scale-load-smoke.json` for dry-run driver coverage, then rerun with `--base-url` and `--api-key` against the target environment for live latency evidence. Full live scale-load coverage includes local-import connector syncs and imported OpenAPI tool dispatch-request enqueue/cancel; enable `TOOL_OPERATION_EXECUTION_DRIVER=http-fetch` in the target when collecting that evidence.
- Run `pnpm smoke:compose:scale` for a clean local Compose scale smoke before promoting a scale-related change.
- Run schema validation after migration and after restore.
- Run `pnpm review:postgres-query-plans -- --representative-volume --target-tier enterprise --postgres-mode external-hosted-postgres --output dist/scale/postgres-query-plan-review.json` against the target Postgres instance after migration and representative load. Treat missing expected indexes as blockers; treat observed sequential scans on tiny datasets as advisory until representative load evidence exists.
- Run `pnpm collect:postgres-telemetry -- --slow-output dist/scale/postgres-slow-query-telemetry.json --lock-output dist/scale/postgres-lock-telemetry.json` against the target Postgres instance after enabling `pg_stat_statements` and collecting representative traffic. Tune `--slow-threshold-ms`, `--max-blocked-sessions`, and `--max-deadlocks` to the selected tier before release promotion.
- Run `pnpm decide:postgres-archival -- --decision no_runtime_partitioning_enabled --accept-decision --output dist/scale/postgres-archival-partitioning-decision.json` only after reviewing target table growth, retention, and restore windows. Tune `--max-table-bytes`, `--max-estimated-rows`, and `--max-dead-tuple-ratio-percent`; if the selected decision conflicts with the thresholds, the command fails instead of accepting the evidence. Use `partitioning_required`, `archival_required`, or `partitioning_and_archival_required` when target evidence proves a forward migration or retention-worker change is required.
- Read `GET /api/v1/admin/postgres/operational-posture` or `client.admin.postgresOperationalPosture()` after deployment to confirm the API is surfacing `POSTGRES_POOL_MAX`, query-plan coverage, slow-query telemetry, lock telemetry, and archival/partitioning evidence gaps without returning database URLs, SQL, row data, lock statements, evidence paths, telemetry sample SQL, or secrets. Mount sanitized target evidence into the app and set `POSTGRES_QUERY_PLAN_EVIDENCE_PATH`, `POSTGRES_SLOW_QUERY_TELEMETRY_EVIDENCE_PATH`, `POSTGRES_LOCK_TELEMETRY_EVIDENCE_PATH`, and `POSTGRES_ARCHIVAL_PARTITIONING_DECISION_PATH` only when those files have been reviewed for redaction.
- Run `pnpm smoke:compose:object-store-outage` before promoting Compose object-store or attachment-path changes. For Kubernetes, run the equivalent target-tier object-store outage drill and record pod/job log redaction evidence.
- Run the matching Compose or Kubernetes smoke.
- Verify generated secret and raw-content log scanning for app, worker, migration, backup, restore, and scaler paths.
- Capture representative load or soak results for the selected tier.
- Record any exception, such as lower connection headroom or broader worker concurrency, with owner and expiry.
