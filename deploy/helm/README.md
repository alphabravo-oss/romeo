# Romeo Helm deployment policy

The chart is production-shaped and intentionally fails closed. A production
release must replace the render-only sentinels and provide all of the following:

- `image.digest=sha256:...` for the exact published application manifest;
- `opsImage.digest=sha256:...` for the separately published operational
  manifest used by migrations, workers, and backups;
- `valkey.urlSecret.name` and `key` for distributed HTTP limiting and quota
  coordination;
- a pre-created `secrets.existingSecret`; production rejects
  `secrets.create=true` and every nonempty `secretEnv` value so credentials
  never enter Helm release metadata;
- a deployment-specific `networkPolicy.egress` allowlist covering DNS,
  Postgres, Valkey, object storage, telemetry, and enabled providers;
- the exact reverse-proxy source CIDRs in `env.EDGE_TRUSTED_PROXY_CIDRS`,
  aligned with an explicit `networkPolicy.ingressFrom` boundary;
- required malware scanning, non-root/read-only security contexts,
  dependency-aware readiness, and the pre-upgrade migration hook (the secure
  values defaults already enable these controls).

Default values intentionally pass `helm lint` and `helm template` so the chart
can be inspected and tested without production credentials. They are not an
installable deployment profile: the all-zero application/ops digests cannot be
pulled, `romeo-required-valkey-url` is not created by the chart, S3 and runtime
secrets are absent, the backup owner/evidence fields are uppercase replacement
sentinels, and the only default egress destination is reserved TEST-NET
`192.0.2.1:9`. A release pipeline must replace every sentinel with target-bound
values and retain the rendered-manifest evidence.

Application startup independently enforces the secret-backed connection
details that Helm cannot inspect. External Postgres must use
`sslmode=verify-full`. External Valkey must use `rediss://` with a nonempty ACL
username and a non-placeholder password; the runtime readiness client then
performs authenticated database selection and `PING` instead of accepting a
bare TCP connection. Durable repository/object
storage, distributed realtime/rate/quota drivers, ClamAV, capability-specific
credentials, independent high-entropy signing/encryption keys, and notification
webhook host allowlists are also mandatory whenever their production paths are
enabled.

`/api/v1/health` is process-only. Kubernetes readiness executes a loopback-only
`/api/v1/readyz` request. That endpoint runs a real PostgreSQL `SELECT 1`,
requires the exact ordered migration journal and a NOINHERIT/NOSUPERUSER/
NOBYPASSRLS login with both tenant and coordinator role memberships, checks
Valkey through the authenticated configured client, verifies production config,
and requires fresh healthy essential-scheduler ownership. It also performs an
authenticated, time-bounded S3 bucket check,
inspects default encryption/versioning/lifecycle posture (and replication when
required), then writes, reads, and deletes a random reserved-prefix object.
Only boolean posture is reported; bucket, endpoint, object names, and provider
errors are never returned. Expensive database, migration, Valkey, and object
checks are single-flighted and cached for at most a short bounded TTL; failures
have a shorter TTL and stale success never passes indefinitely. The internal
probe route is reachable only from the loopback transport peer and is not an
ingress health API. Graceful drain marks it unready before worker shutdown.

Forwarding headers are trusted only when the server adapter's transport peer
matches `EDGE_TRUSTED_PROXY_CIDRS`. Set `EDGE_TRUSTED_PROXY_HOPS` to the real
chain depth and allow those same ingress-controller or load-balancer sources in
`networkPolicy.ingressFrom`. The loopback defaults are render-only sentinels;
they deliberately do not trust a cluster ingress path.

Plaintext Postgres or Valkey is limited to in-cluster service names and requires
a named owner, reviewed reason, future UTC expiry no more than 90 days away,
and the corresponding `*_EXCEPTION_*` fields. Valkey additionally requires
`VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED=true`. Disabling malware scanning has
the same owner/reason/expiry contract. Hardened controls reject unnecessary
exceptions so temporary waivers cannot silently become permanent policy.

The chart renders a release-wide ingress/egress default-deny policy for every
Romeo-labeled pod, then explicit app and generic operations allow policies.
Tool-dispatch and browser-automation are excluded from the generic policy and
retain their narrower component policies. The egress entries in
`networkpolicy-egress-values.example.yaml` are examples,
not production destinations. Replace every namespace, selector, and TEST-NET
CIDR with reviewed values for the target cluster.

Backups must use exactly one explicit ownership mode. Set
`backup.mode=managed-verified` with `backup.enabled=true` and Secret-backed
presigned upload/readback URLs for the dump, manifest, and status artifacts,
plus `policyReadbackUrlSecret` for fresh destination lifecycle evidence.
The CronJob exits non-zero unless each remote readback has the expected byte
count and SHA-256 digest and the destination proves versioning, replication,
object lock, protected manifests/indexes, legal hold, and a deletion schedule
that cannot precede minimum retention. Alternatively, set
`backup.mode=externally-managed`,
keep `backup.enabled=false`, and provide a named owner plus a reviewed evidence
reference, observation time, live status reference, and configured alerting for
the database platform's scheduling, verification, age alert, and restore drill.
A disabled CronJob without that external declaration is rejected. All-tenant
webhook/notification retry, retention, billing lifecycle, and
provider/voice synchronization are owned by the application's fenced internal
coordinator by default; their former tenant-token CronJobs are rejected. Set
both `env.SCHEDULED_TENANT_WORK_OWNER=external` and
`essentialOperations.scheduledTenantWork.mode=external` only with an
accountable owner, reviewed evidence/status references, alerting, and a mounted
fresh `romeo.external-scheduled-operations.v1` ConfigMap document covering the
exact operation set. Missing, stale, degraded, or tampered evidence makes every
replica unready. Externally owned object backup and disaster recovery likewise
require owner/evidence/status/alert declarations.

Tool dispatch, browser automation, and knowledge extraction are separate
brokered execution boundaries. Each enabled workload must have a distinct
`identity.serviceAccount`, broker `credentialSecret`, exact audience/scope,
and component NetworkPolicy. The chart mounts the credential only as
`TOOL_DISPATCH_BROKER_TOKEN`, `BROWSER_AUTOMATION_BROKER_TOKEN`, or
`KNOWLEDGE_EXTRACTION_BROKER_TOKEN`; it never falls back to a shared API key or
global-admin principal. Migration and backup also use distinct ServiceAccounts
and mount only their required database/destination Secret references.
The app-side broker mounts each enabled identity's `credentialSecret` and
optional `previousCredentialSecret`; worker pods mount only the current Secret
so rotation remains read-old/write-new without exposing retired credentials.
Their component NetworkPolicies include an exact same-release app rule for the
broker API; tool/browser external egress remains operator allowlisted and
knowledge extraction uses an isolated app-only policy by default.

High-risk capability emergency controls are operator-only. Set
`env.CAPABILITY_PLATFORM_DISABLED_IDS` to an exact comma-separated subset of
`realtime_voice`, `external_provider_use`, `secure_compute`,
`image_generation`, `image_editing`, `multi_model_compare`, and
`streamed_output_policy`. Unknown, duplicate, empty, or whitespace-padded
entries fail application startup. Safe defaults keep future high-risk classes
disabled while preserving the existing governed image-generation behavior;
an explicit empty value removes the platform deny, but unavailable features
remain unavailable through their other capability dimensions.

```sh
export ROMEO_IMAGE_DIGEST='sha256:<64 hex characters from the release manifest>'
export ROMEO_OPS_IMAGE_DIGEST='sha256:<64 hex characters from the release manifest>'

helm upgrade --install romeo deploy/helm \
  --namespace romeo \
  --values deploy/helm/external-postgres-values.example.yaml \
  --values deploy/helm/networkpolicy-egress-values.example.yaml \
  --set-string image.digest="$ROMEO_IMAGE_DIGEST" \
  --set-string opsImage.digest="$ROMEO_OPS_IMAGE_DIGEST"
```

`imagePolicyException` is an audited development-only escape hatch for a
registry that cannot publish a digest. It requires an explicit reason and does
not bypass any other production invariant. Do not use it for a release.

Run the local deployment gates before publishing:

```sh
pnpm check:helm-production-policy
pnpm check:container-image-policy
```

The second command requires a running Docker engine. Use
`node scripts/container-image-policy.mjs --static-only` only for environments
that cannot run image builds; release validation must run the full command.

Before promotion, retain target-environment evidence that Postgres and Valkey
reject an untrusted CA and wrong server name, that authenticated Valkey commands
survive credential rotation, and that ClamAV rejects EICAR while scanner outage
fails uploads closed. Static config and Helm checks intentionally do not claim
those live infrastructure proofs.
