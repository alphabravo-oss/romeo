# Romeo KEDA Examples

These manifests are optional examples for clusters that run KEDA. They are intentionally outside the Romeo Helm chart so the default chart stays compatible with Docker Compose parity, plain Kubernetes CronJobs, and clusters that do not install KEDA CRDs.

Prerequisites:

- KEDA installed in the cluster.
- Romeo deployed through `deploy/helm` with the app Service named `romeo`.
- A worker API key Secret named `romeo-worker-api-key` with key `ROMEO_API_KEY`.
- A Postgres connection Secret named `romeo-postgres` with key `DATABASE_URL`.
- NetworkPolicy or CNI egress rules that allow the KEDA operator to reach Postgres and worker Jobs to reach the Romeo app Service.

Files:

- `webhook-retry-scaledjob.example.yaml`: queue-lag driven webhook retry worker. The ScaledJob polls `webhook_deliveries` for failed deliveries whose `next_attempt_at` is due, then starts bounded one-shot `romeo workers webhook-retry --once` Jobs.

The example uses a KEDA `TriggerAuthentication` with `secretTargetRef` so the Postgres connection string is read by KEDA from the Secret, not mounted into the worker Job. The worker Job receives only `ROMEO_BASE_URL` and the scoped worker API key it needs to call the public API.

Minimal flow:

```sh
kubectl apply -n romeo -f deploy/keda/webhook-retry-scaledjob.example.yaml
kubectl get scaledjob,triggerauthentication -n romeo
ROMEO_API_KEY="$SCOPED_ADMIN_OR_OPERATOR_KEY" pnpm smoke:kubernetes:keda -- --namespace romeo --keda-namespace keda --output dist/ci/kubernetes-keda-smoke.json
```

Use only one scheduling path for webhook retry in a namespace. Disable the Helm CronJob (`workers.webhookRetry.enabled=false`) when this ScaledJob is active, or keep the CronJob as the scheduler until KEDA live evidence has been collected for the cluster.

Before production use, tune `maxReplicaCount` against Postgres connection limits, provider webhook retry policy, and the Romeo API rate limit. Live validation must prove that jobs scale from backlog, drain to zero, avoid duplicate unsafe delivery attempts, and keep KEDA/operator/job logs free of connection strings, API keys, webhook payloads, and raw event bodies. The smoke seeds a failing webhook delivery through the Romeo API, waits until retry is due, requires a KEDA-created worker Job to complete, verifies the delivery was retried through API readback, and writes only metadata/counts/redaction posture.
