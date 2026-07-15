# Execution Backlog: Enterprise Platform

This file covers the remaining Phase 21, Phase 22, and Phase 23 work required for enterprise deployment and release readiness.

## HAM-P21-01: Kubernetes External Postgres Live Smoke

Phase: 21 Kubernetes Enterprise Platform.

Depends on: Phase 19 migration command and Helm external Postgres render.

Goal: prove Romeo starts in Kubernetes against an external Postgres-compatible database using the same contract as Compose.

Current status: live-smoke harness implemented as `pnpm smoke:kubernetes:live`. It creates a temporary namespace with smoke-owned Postgres, Valkey, RustFS, runtime Secrets, and a Helm release in external-Postgres mode; runs migration and explicit seed; sets a local admin password; upgrades to seeded login disabled; verifies readiness, auth denial, local auth/MFA fallback, unconfigured OIDC fail-closed behavior, `/me` tenancy readback, product workflow readback, attachment readback, redacted webhook-delivery readback, app Deployment restart readback, and pod/job generated secret/raw-content/auth log scanning. The harness now loads locally built images into disposable `kind-*` clusters, checks kind node disk headroom before creating the smoke namespace, and Helm renders writable `/tmp`-based Node/Corepack cache env for app, migration, backup, and worker containers so restricted non-root pods can run `pnpm` commands. Live evidence is still pending until run against a reachable Kubernetes cluster with enough node disk headroom and reviewed images; the local Rancher Desktop context observed on June 30, 2026 had Kubernetes disabled, and the July 7, 2026 kind attempt reached the migration phase but the workstation's Docker disk filled before a complete live evidence artifact could be collected.

Latest local validation for the Kubernetes auth-harness update passed `node --check` for `scripts/lib/auth-smoke-support.mjs`, `scripts/lib/totp.mjs`, `scripts/compose-auth-smoke.mjs`, and `scripts/kubernetes-live-smoke.mjs`; focused Prettier; docs command-check with `dist/ci/docs-command-check-kubernetes-auth-smoke.json`; offline Kubernetes render smoke with `dist/ci/kubernetes-render-kubernetes-auth-smoke.json`; and live Compose auth smoke through the shared helper with `dist/ci/compose-auth-smoke-kubernetes-shared.json`. The Kubernetes live evidence remains pending because no reachable cluster was available in this environment.

Scope details:

- Use a local cluster or staging namespace.
- Provide `DATABASE_URL` through a Secret or External Secrets-managed Secret.
- Use S3-compatible object storage and external or in-cluster Valkey according to the test environment.

Tasks:

- Create a tested values file for external Postgres mode.
- Run Helm install with migration job enabled.
- Validate migration job completion and app readiness.
- Create a scoped admin API key and run a small product workflow.
- Verify object-store artifact readback.
- Collect pod logs and scan for secrets and payload sentinels.
- Run `pnpm smoke:kubernetes:live` against a reachable local or staging cluster. Local disposable `kind-*` contexts can use the harness-managed Docker build because the smoke now loads the built image into kind before Helm install; regulated or GA-target runs still use `--skip-build --image` with a reviewed registry-hosted digest-pinned image.

Definition of done:

- App pods become ready only after migration and safe production config checks pass.
- External Postgres mode requires no application code changes.
- Product workflow records survive app pod restart.

Testing:

- `helm lint`.
- `helm template` with external Postgres values.
- Live install smoke in a namespace.
- `pnpm smoke:kubernetes:live`.
- Pod restart persistence test.
- Redaction scan over app, migration, and worker logs.

Validation and evidence:

- `kubernetes-external-postgres-smoke.json`.
- `romeo.kubernetes-live-smoke.v1` output from `pnpm smoke:kubernetes:live`.
- Migration job logs with redacted connection metadata.
- Readiness report.
- Artifact readback proof.

Compose and Kubernetes impact:

- Compose external Postgres docs and Kubernetes external Postgres docs must describe the same app-level contract.

Security and migration notes:

- Use Secret references only; do not inline database URLs in values examples intended for production.

## HAM-P21-02: CloudNativePG Operator Path

Phase: 21 Kubernetes Enterprise Platform.

Depends on: Helm CloudNativePG connection-secret mode and operator availability.

Goal: document and validate Romeo with a CloudNativePG-managed Postgres cluster without making the Romeo chart own every operator concern.

Current status: operator-side examples and offline validation implemented. `deploy/cloudnativepg` now contains separate Barman Cloud plugin ObjectStore, primary Cluster, ScheduledBackup, on-demand Backup, and isolated restore Cluster examples. `deploy/helm/cloudnativepg-values.example.yaml` consumes the CloudNativePG app Secret key `uri` through the same `DATABASE_URL` environment contract. `pnpm smoke:kubernetes:render` validates the examples for pgvector init, Secret-backed object-store credentials, plugin WAL archiving, scheduled/on-demand backup shape, and isolated restore source wiring. Live operator e2e and restore evidence remain pending until a cluster with CloudNativePG and the Barman Cloud plugin is available.

Scope details:

- Support operator-managed cluster creation through examples or separate manifests.
- Use a pgvector-capable image or documented extension path.
- Keep owner, migration, app, and backup roles separate where supported.

Tasks:

- Add or refine CloudNativePG example manifests and values.
- Document required operator version, pgvector image, bootstrap SQL, WAL archive, backup, and restore path.
- Validate that Romeo consumes the CloudNativePG app connection Secret.
- Run migration, schema validation, app readiness, workflow smoke, and backup/restore drill where an operator is available.

Definition of done:

- CloudNativePG mode is documented as an operator-managed database path.
- Romeo app behavior matches external Postgres mode.
- Restore into a replacement CloudNativePG cluster is documented.

Testing:

- Helm render with CloudNativePG values.
- Offline CloudNativePG manifest validation through `pnpm smoke:kubernetes:render`.
- CloudNativePG manifest validation with cluster tooling where available.
- Live e2e when operator is available.
- Backup and restore documentation test.

Validation and evidence:

- `kubernetes-cloudnativepg-smoke.json` where live-tested.
- Render evidence where live operator testing is unavailable.
- `romeo.kubernetes-render-smoke.v1` evidence with `cloudnativepg_operator_examples`.
- CloudNativePG restore runbook evidence.

Compose and Kubernetes impact:

- Compose remains independent of Kubernetes and CloudNativePG.
- Database scripts stay shared across Compose, external Postgres, and CloudNativePG modes.

Security and migration notes:

- Separate connection roles should avoid app runtime owner privileges where feasible.
- WAL archive credentials must not be exposed to app pods unless required.

## HAM-P21-03: Kubernetes Database And Object-Store DR Drill

Phase: 21 Kubernetes Enterprise Platform.

Depends on: Postgres/object-store backup scripts and Kubernetes install path.

Goal: prove Kubernetes deployments can restore database and object-store state into an isolated environment and serve restored data.

Current status: live harness implemented as `pnpm smoke:kubernetes:dr`. External Postgres mode creates disposable source and restore namespaces with smoke-owned pgvector, Valkey, and RustFS dependencies, then runs the same Postgres/object-store backup, restore, DR drill, schema validation, readiness, API readback, attachment readback, and pod-log redaction checks used by the Compose DR path. CloudNativePG mode uses operator-managed source and restore `DATABASE_URL` Secrets through `--source-database-url-secret name:key` and `--restore-database-url-secret name:key`, while keeping the application, maintenance jobs, and API readback path identical. `pnpm ga:target-preflight` now requires the DR plan plus `KUBERNETES_DR_SKIP_BUILD=true` and a reviewed digest-pinned `KUBERNETES_DR_APP_IMAGE`, emits `--skip-build --image $KUBERNETES_DR_APP_IMAGE` commands for both required modes, and does not require Docker on the target evidence-collection host. Live evidence is still pending until run against a reachable Kubernetes cluster with an approved external Postgres target and CloudNativePG source/restore clusters.

Scope details:

- Cover both external Postgres and CloudNativePG where available.
- Restore object-store artifacts before app traffic.
- Validate database references against restored object bytes through authenticated Romeo API reads.

Tasks:

- Define source and isolated restore namespaces.
- Run Postgres backup and object-store backup.
- Restore object store to explicit target bucket.
- Restore Postgres into isolated target database or cluster.
- Run schema validation.
- Start app against restored targets with seeded login disabled.
- Read restored chats, knowledge records, audit records, usage records, and artifact bytes.

Definition of done:

- DR ordering is executable: restore objects, restore Postgres, validate schema, start app.
- Restored environment passes readiness.
- Restored records and artifacts are readable through authorized APIs.

Testing:

- Kubernetes backup CronJob or one-shot Job.
- Restore Job with confirmation guard.
- Object-store restore drill with SHA-256 verification.
- App readiness and restored workflow smoke.

Validation and evidence:

- `dist/ci/kubernetes-external-postgres-dr.json`.
- `dist/ci/kubernetes-cloudnativepg-dr.json`.
- Postgres backup manifest.
- Object-store backup manifest.
- Redacted restore logs.

Compose and Kubernetes impact:

- Kubernetes DR uses the same scripts as Compose with environment-specific Secret injection.

Security and migration notes:

- Restore jobs are destructive and must require explicit isolated-target confirmation.
- Evidence must redact object-store credentials and database URLs.

## HAM-P21-04: NetworkPolicy, RBAC, And Restricted Pod Evidence

Phase: 21 Kubernetes Enterprise Platform.

Depends on: Helm templates and worker examples.

Goal: prove the default Kubernetes posture is compatible with restricted enterprise clusters.

Current status: partially implemented through offline chart-contract evidence plus a guarded live CNI harness. `pnpm smoke:kubernetes:render` now runs Helm lint, verifies values-schema rejection for invalid Postgres mode, renders default, external Postgres, CloudNativePG, enterprise-surface, and explicit-egress NetworkPolicy variants, and structurally checks Secret references, ConfigMap redaction, app/migration/worker/backup resources, ServiceAccounts, probes, CPU/memory resources, non-root pod security, dropped capabilities, disabled privilege escalation, default-deny NetworkPolicy, explicit DNS/Postgres/Valkey/object-store/HTTPS/OTLP egress examples, component-scoped tool-dispatch NetworkPolicy output, Ingress, and HPA output. The explicit egress example now shows separate app and tool-dispatch worker egress contracts, with the worker policy opening only DNS, the Romeo app pod, and a documentation external HTTPS CIDR. `pnpm smoke:kubernetes:networkpolicy` now creates a temporary namespace, proves baseline client connectivity to two pods, applies an app-labeled egress policy, requires allowed egress to stay reachable, requires denied egress to fail, and scans pod logs for a generated sentinel; dry-run output remains planning evidence only. Remaining work is live execution against the selected cluster/CNI, full Romeo pod/job log redaction scans, and any deployment-specific CNI negative tests.

Scope details:

- Cover app, migration job, worker CronJobs, backup jobs, future long-running workers, and optional ingress.
- Include default-deny NetworkPolicy examples and explicit egress openings.

Tasks:

- Review rendered ServiceAccounts, Roles, RoleBindings, SecurityContexts, PodSecurityContexts, probes, resources, PDBs, and NetworkPolicies.
- Add examples for Postgres, Valkey, object store, OIDC issuer, provider APIs, telemetry, connector allowlists, and notification providers.
- Validate non-root, no privilege escalation, dropped capabilities, `RuntimeDefault` seccomp, and read-only root filesystem where feasible.
- Run `pnpm smoke:kubernetes:networkpolicy` against each accepted cluster/CNI profile and keep live evidence with the release bundle.
- Run negative egress tests where the local cluster/CNI supports it.

Definition of done:

- App and worker pods run under restricted pod security settings by default.
- Broad egress, hostPath, privileged mode, and broad Secret mounts are absent by default.
- Required egress is documented and explicitly configured.

Testing:

- `pnpm smoke:kubernetes:render`.
- `pnpm smoke:kubernetes:networkpolicy` against a live NetworkPolicy-enforcing cluster.
- `helm template romeo deploy/helm -f deploy/helm/external-postgres-values.example.yaml -f deploy/helm/networkpolicy-egress-values.example.yaml`.
- Policy conformance checks with available cluster tools.
- NetworkPolicy negative tests where supported.
- Pod log redaction checks.

Validation and evidence:

- Restricted-pod posture report.
- NetworkPolicy render evidence.
- `romeo.kubernetes-networkpolicy-smoke.v1` live evidence.
- Explicit-egress values evidence for DNS, Postgres, Valkey, object store, HTTPS provider/identity/notification ranges, and OTLP telemetry.
- Exception list, if any, with owner and risk acceptance.

Compose and Kubernetes impact:

- Compose security limitations remain documented separately and must not be presented as equivalent to Kubernetes isolation.

Security and migration notes:

- Future browser/tool workers must not inherit broad app pod network access.

## HAM-P21-05: Autoscaling, Resource, And Worker Scheduling Model

Phase: 21 Kubernetes Enterprise Platform.

Depends on: worker commands and resource defaults.

Goal: provide enterprise-ready resource and scaling defaults without hiding overload behind unbounded workers.

Current status: partially implemented. The Helm chart now renders an `autoscaling/v2` app HorizontalPodAutoscaler when `autoscaling.enabled=true`, with configurable min/max replicas and CPU/memory utilization targets. The render smoke verifies HPA output and that Deployment replicas are omitted when HPA owns scaling. `POSTGRES_POOL_MAX` now caps the app process database pool and is schema-validated in Helm values. Worker scheduling remains CronJob-based with bounded commands and resource settings by default, and the Postgres backup CronJob now has schema-validated `backup.uploadTimeoutMs` wired to `POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS`. `deploy/keda/webhook-retry-scaledjob.example.yaml` now provides an optional KEDA ScaledJob path for due webhook retry work using Secret-backed PostgreSQL scaler auth, and `pnpm smoke:kubernetes:render` validates that example offline. `pnpm smoke:kubernetes:keda` now provides the guarded live scaler harness for the optional ScaledJob, including API-seeded due webhook retry backlog, KEDA-created worker Job completion, delivery retry readback, and KEDA/operator/job log redaction. `pnpm ga:checklist -- --require-keda` / `GA_REQUIRE_KEDA=true` now makes that live KEDA evidence a hard release gate for deployments that enable KEDA, rejecting dry-run or incomplete scaler output. `/api/v1/jobs/operational-summary`, CLI `romeo jobs summary`, SDK generation, and `pnpm smoke:jobs:lag` now provide generalized metadata-only queued-lag, stale-running, recent-failure, and dead-letter visibility for background jobs without exposing job payloads. `docs/deployment-sizing.md` now defines initial connection-budget math and tier targets. Live KEDA scaler execution, tool-dispatch scaling, live alert firing, and load-proven tier evidence remain open.

Scope details:

- App Deployment HPA hooks.
- CronJob scheduling for polling workers.
- Optional KEDA hooks for durable due-work queries where a deployable one-shot worker exists.
- Connection-pool and concurrency formulas relative to Postgres limits.

Tasks:

- Keep values for app HPA and worker resource overrides.
- Document when workers are CronJobs versus Deployments.
- Define concurrency and timeout settings per worker class.
- Document graceful shutdown and drain behavior.
- Keep queue-lag, job-lag, and dead-letter operational summary coverage metadata-only, and map it into the selected monitoring stack before production.
- Extend KEDA examples only after the corresponding one-shot worker command, queue schema, idempotency semantics, and secret boundary are implemented.

Definition of done:

- Operators can size app and worker pods for small self-hosted, enterprise self-hosted, and hosted tiers.
- Worker concurrency cannot exceed documented Postgres/provider limits by default.
- Scaling settings are explicit in values and docs.

Testing:

- `pnpm smoke:kubernetes:render` for HPA-enabled app.
- CronJob render for each worker.
- Offline validation for optional KEDA ScaledJob examples.
- Worker timeout and max-iteration tests.
- `pnpm smoke:jobs:lag`.
- Restart/drain smoke where feasible.

Validation and evidence:

- Rendered autoscaling manifests.
- Sizing guide at `docs/deployment-sizing.md`.
- Worker scheduling evidence.
- Background job lag smoke evidence.
- KEDA live-scaler evidence for deployments that enable ScaledJobs.

Compose and Kubernetes impact:

- Compose profiles remain simpler but should expose equivalent worker loop settings for local validation.

Security and migration notes:

- Scaling must not require sharing broad secrets across worker classes.

## HAM-P22-01: CI Quality Gates

Phase: 22 Release, CI, And Supply Chain.

Depends on: stable migration command and core smoke scripts.

Goal: make platform and product regressions block merges.

Current status: implemented as repository CI wiring with an offline branch-protection plan, local hosted CI run verifier, and local branch-protection verifier, pending live hosted CI run evidence and applying branch-protection settings in GitHub. `.github/workflows/ci.yml` now defines jobs for changed-file formatting, OpenAPI/Python SDK drift, OpenAPI route coverage, typecheck, tests, build, greenfield baseline review, repository conformance coverage, branch-protection plan generation, background job lag smoke, provider resilience smoke, backup upload-failure smoke, live pgvector migration/schema/conformance, Helm render smoke, release-evidence dry run with release provenance, air-gapped bundle verification, planned readback validation, and serialized Compose smoke variants. `pnpm ci:branch-protection-plan` validates the workflow shape, required jobs, required release/quality commands, Compose matrix entries, and writes redacted `romeo.branch-protection-plan.v1` evidence listing the required GitHub status checks without workflow bodies or secret values. `pnpm ci:hosted-run-verify` reads the hosted GitHub Actions run and jobs APIs to verify the selected or latest completed workflow run against those required checks without returning job logs, raw API responses, repository slugs, run URLs, or token values. Local validation passed the SDK drift gate, OpenAPI route coverage, broad workspace gates, baseline/conformance evidence, Helm render smoke, release-evidence dry run, provenance generation/validation, planned readback validation, readback mismatch failure-injection, branch-protection plan generation, hosted CI run verifier contract coverage, job-lag smoke, provider resilience smoke, backup upload-failure smoke, and live pgvector CI-equivalent conformance. Repo-wide Prettier remains a separate cleanup task because existing source files predate the formatter gate; CI enforces formatting only on changed files to avoid unrelated churn.

Latest local validation for the hosted CI and branch-protection evidence slice passed script syntax, positive `pnpm ci:branch-protection-plan`, hosted-run verifier dry-run, hosted-run contract smoke, branch-protection verifier dry-run, branch-protection contract smoke, missing-workflow failure injection, docs updates, and the broad workspace gates. Live hosted CI evidence and hosted GitHub branch-protection application remain environment actions outside the local repository.

Scope details:

- Formatting, lint/typecheck, unit tests, integration tests, OpenAPI route coverage, SDK drift, migration validation, Postgres conformance, Compose render/smoke, Helm render/lint, redaction tests, and security evidence generation.

Tasks:

- Define CI jobs and dependencies.
- Add pgvector service for Postgres conformance.
- Run Compose smoke jobs in an environment that supports Docker.
- Run Helm render and schema validation.
- Generate release/security/provenance evidence in dry-run mode.
- Upload redacted artifacts.

Definition of done:

- CI blocks merges on the accepted quality gates.
- Required jobs produce actionable redacted evidence.
- Required GitHub status checks are generated as `romeo.branch-protection-plan.v1` evidence.
- Hosted CI run verification evidence proves the selected or latest completed workflow run has every required status-check job present and successful.
- Releases that claim hosted CI governance is complete can require `phase22.ci_governance_live` with `pnpm ga:checklist -- --require-ci-governance-live` / `GA_REQUIRE_CI_GOVERNANCE_LIVE=true`, and preflight blocks until reviewed CI governance evidence, repository target, token env, and run selector env are present.
- Flaky or environment-specific jobs have clear retry and quarantine policy.

Testing:

- Pull request CI dry run.
- Failure injection for schema drift, OpenAPI drift, SDK drift, and redaction leak.
- Compose and Helm CI render checks.

Validation and evidence:

- CI run summary.
- Artifact list.
- Required status-check configuration.
- `branch-protection-plan.json`.
- `hosted-ci-run-verification.json`.
- `branch-protection-verification.json`.
- `pnpm ga:checklist -- --require-ci-governance-live` validates hosted CI run evidence, hosted branch-protection verification, two-approval branch policy, blocker-free evidence, and redaction flags.
- Local dry-run evidence: `pnpm check:sdk-drift`, `pnpm check:openapi-route-coverage`, `pnpm check`, `pnpm test`, `pnpm build`, `pnpm review:baseline -- --strict`, `pnpm review:repository-conformance -- --strict`, `pnpm smoke:kubernetes:render -- --output dist/ci/kubernetes-render-smoke.json`, live `pgvector/pgvector:pg18` migration/schema/conformance, the release-evidence dry-run command chain including `pnpm release:provenance`, planned readback validation, and readback digest-mismatch failure injection.

Compose and Kubernetes impact:

- CI must test both Compose and Helm paths before release.

Security and migration notes:

- CI logs must not expose secrets from service containers or registry credentials.

## HAM-P22-02: Release Publish And Readback

Phase: 22 Release, CI, And Supply Chain.

Depends on: release pack, publish plan, security evidence, and registry credentials.

Goal: publish verifiable artifacts and read them back before promotion.

Current status: partially implemented for offline release evidence, provenance validation, protected-approval evidence validation, air-gapped bundle verification, readback validation, and sanitized runtime release-security/readback posture. `pnpm release:pack`, `pnpm sbom:generate`, `pnpm release:channel`, `pnpm containers:scan-plan`, `pnpm release:security`, `pnpm release:provenance`, `pnpm release:approval`, `pnpm release:upgrade-check`, `pnpm release:publish-plan`, `pnpm release:airgap-check`, `pnpm release:readback-collect -- --dry-run`, `pnpm release:readback-check -- --planned-readback`, and `pnpm smoke:release:readback` all run locally or in CI dry-run/smoke mode. `pnpm release:provenance` writes redacted `romeo.release-provenance.v1` evidence that validates manifest, channel, security, SBOM, and artifact digests, hashes source repository/ref/builder/CI metadata, and supports signature or attestation file/ref evidence without returning raw signature or attestation bodies. `pnpm release:approval` writes redacted `romeo.release-approval.v1` evidence after a protected release approval has happened, tying hashed approval reference and hashed approver IDs to the manifest and provenance digests while enforcing minimum approver count and optional expiry without returning raw approval references, raw approver IDs, file bodies, secret values, or environment dumps. `pnpm release:publish-plan -- --require-provenance --require-approval` now fails closed on missing, blocked, mismatched, expired, under-approved, or redaction-unsafe provenance/approval evidence, and `--require-signed-provenance` can require a signature or attestation in release environments. `pnpm release:airgap-check -- --require-approval --require-readback-validation` now writes redacted `romeo.airgap-bundle-verification.v1` evidence for disconnected bundle directories, validating package tarball size/hash matches, channel/security/provenance/SBOM version and digest linkage, optional signed provenance, release-approval schema/digest/redaction linkage when present or required, optional GA bundle linkage, optional publish-plan linkage, missing-artifact failure behavior, and required live readback-validation proof for package/image/chart/release-asset promotion. If a GA bundle is required too, the airgap verifier requires the GA bundle to hash-link the same readback-validation file. It omits package contents, SBOM bodies, provenance bodies, approval bodies, raw readback bodies, registry tokens, absolute bundle paths, or secret-like environment values. `GET /api/v1/admin/release-security/posture` and `client.admin.releaseSecurityPosture()` can read reviewed mounted provenance, approval, publish-plan, and airgap evidence through explicit `RELEASE_*` evidence-path env vars and expose only status/count/boolean/warning metadata. `pnpm release:readback-collect` now performs credentialed npm-compatible registry metadata/tarball readback for published packages, can fetch and verify OCI image manifests against expected immutable digests, can fetch Helm repository `index.yaml` plus chart package bytes against expected immutable digests, can fetch bearer-protected release assets such as channel, security-evidence, SBOM, provenance, and approval documents against expected digests, and writes token-redacted `romeo.release-readback.v1` evidence. The readback validator requires credentialed live npm registry readback and fails closed on package digest mismatches; required image/chart/asset promotion checks now require actual OCI registry, Helm repository, or remote release-asset readback, not declaration-only digests. The loopback smoke proves those collector/validator paths plus token redaction and can copy explicitly named loopback raw readback/validation artifacts into `dist/release` for downstream airgap contract validation while leaving default final-promotion filenames reserved for target evidence. Credentialed staging publish, actual hosted protected approval execution, signed/attested provenance attachment in the release environment, live package/image/chart/release-asset readback execution, target airgap verification when shipped, and promotion failure on mismatch remain open.

Latest local validation for the protected-approval, release-asset readback, and airgap readback-validation slice passed script syntax, positive `pnpm release:approval`, positive `pnpm release:publish-plan -- --require-approval`, missing-approval failure injection, expired-approval failure injection, `pnpm smoke:release:readback -- --output dist/ci/release-readback-smoke-assets.json` with verified package/image/chart/release-asset readback and declared-only asset rejection, loopback readback/validation copy-out for airgap contract validation, positive `pnpm release:airgap-check` with GA bundle, publish-plan, approval, loopback raw-readback, and loopback readback-validation requirements, missing-readback-validation failure injection, docs command-check, strict greenfield baseline review, Kubernetes render smoke, draft GA checklist generation, and broad workspace gates. The default draft GA checklist still keeps credentialed release readback blocked until target evidence exists; no migration files were added.

Scope details:

- npm packages, Python package, container image, Helm chart, SBOM, checksums, provenance/signatures where supported, release notes, and air-gapped bundle.

Tasks:

- Generate and require protected-approval evidence before publishing.
- Execute the actual protected release approval in the hosted release environment.
- Generate release provenance and require it in the publish plan.
- Attach signed or attested provenance in release environments that support it.
- Publish to staging registries first.
- Read back package versions, image digests, chart versions, SBOM/security/provenance/approval asset checksums, and release metadata.
- Fail promotion on any digest or version mismatch.
- Verify disconnected bundle contents before transfer and after mirroring.
- Produce rollback instructions tied to immutable image digest and chart version.

Definition of done:

- Release artifacts can be published and read back with matching digests.
- SBOM and security evidence are attached to the release.
- Rollback metadata is present.

Testing:

- Release candidate dry run.
- Release provenance generation and publish-plan provenance failure injection.
- Release approval evidence generation and publish-plan approval failure injection.
- Air-gapped bundle verification, missing-artifact failure injection, and missing-readback-validation failure injection.
- Loopback release registry and asset readback smoke.
- Staging publish/release-asset readback.
- Failure injection for missing artifact, mismatched digest, failed scan, and missing approval.
- Air-gapped bundle verification.

Validation and evidence:

- `release-manifest.json`.
- `security-evidence.json`.
- `release-provenance.json`.
- `release-approval.json`.
- `release-readback.json`.
- `readback-validation.json`.
- `airgap-bundle-verification.json`.
- Publish/readback report.
- Signed or checksumed release bundle where supported.

Compose and Kubernetes impact:

- Compose docs and Helm values must reference immutable versions or explicit release tags, not floating `latest`.

Security and migration notes:

- Release credentials must be least-privilege and never echoed.

## HAM-P23-00: Enterprise Auth Provider Marketplace

Phase: 23 Enterprise Identity And Lifecycle.

Depends on: local auth/MFA baseline, OIDC bearer/browser PKCE foundation, admin role persistence, and the single greenfield baseline.

Goal: support an enterprise auth-provider catalog that the frontend can render like an app store, with package-backed provider implementations and configuration that can be global for single-org installs or overridden per org when multi-org mode is enabled.

Current status: partially implemented. Local password auth, local TOTP MFA, one-time local MFA recovery codes, user role promotion, explicit global-admin/org-admin service authorization helpers, the static catalog API, persisted global/org auth-provider settings APIs, provider-card connection-test APIs, auth-provider readiness posture checks, local/Vault-backed managed-secret ingestion, staged local MFA and local managed-secret envelope rewrap APIs, authenticated tenancy-mode bootstrap, explicit `/me` OpenAPI bootstrap schema, metadata-only auth-provider setting audit summaries, known-user local login failure-class audits, unknown-principal local login aggregation through a disabled per-org `system_local_auth` audit actor, signed billing webhook system actors, local MFA enrollment/confirmation/recovery-code/disable audits, GitHub direct OAuth2 login, LDAP/Active Directory direct login, SAML direct login, optional SCIM v2 lifecycle, guarded destructive directory sync, and Compose local-auth/MFA fallback smoke evidence are implemented. The catalog exposes local, generic OIDC, Keycloak, Google, Azure AD/Entra ID, Okta, Auth0, GitHub, LDAP, Active Directory, and SAML entries with provider status, protocol, package target, and `global`/`org` configuration scopes; the local auth-provider acceptance smoke now configures and tests that full implemented provider set with metadata-only evidence.

`GET/PATCH /api/v1/admin/auth-providers/settings` persists one global policy plus sparse org overrides through the existing `system_settings` table, reports inherited/effective policy state for the provider app-store page, stores per-provider OIDC issuer/client/group mapping config for implemented OIDC-family providers, stores GitHub OAuth2 connection policy with managed `secretRef` pointers, stores LDAP/AD bind/search policy with managed bind-secret refs, stores SAML SP/IdP connection policy with managed IdP certificate refs, validates managed secret refs, requires explicit confirmation before local fallback is disabled, and audits only changed provider IDs plus change categories for global/org scopes. `POST /api/v1/admin/secrets` defaults to storing one-time pasted secrets as encrypted `romeo-secret://...` refs using `MANAGED_SECRET_ENCRYPTION_KEY`, or writes them to Vault KV-v2 and returns `vault://...` refs when `storageDriver: "vault"` is supplied with configured `VAULT_*` settings; raw secret readback is never available, Vault-backed writes do not persist the raw value locally, and external secret-manager refs remain supported. `POST /api/v1/admin/secret-rotation/rewrap/preview` and `/api/v1/admin/secret-rotation/rewrap` support staged `LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS` and `MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS` rewrap for local TOTP MFA envelopes and local `romeo-secret://` managed-secret envelopes, returning counts, failure codes, and redaction flags only. `TENANCY_MODE=single|multi` is surfaced as `/api/v1/me` `deployment.tenancyMode` for frontend scope-switcher behavior and is documented in the concrete `BootstrapResponse` schema.

`POST /api/v1/admin/auth-providers/settings/test` tests local auth posture, implemented OIDC-family providers through sanitized discovery/JWKS checks, GitHub direct OAuth2 through sanitized client-secret posture, known endpoint posture, and GitHub API metadata reachability, LDAP/AD through sanitized service bind plus base-search checks, and SAML through sanitized adapter/configuration/certificate-ref/endpoint-readiness checks. `GET /api/v1/auth/oidc/start?providerId=...&orgId=...` uses the selected provider's stored global or org-scoped OIDC config through the PKCE start/callback flow, stores `orgId`, provider ID, issuer, nonce, and code verifier in signed HttpOnly state, and validates callback authorization-code grants with `openid-client`, so multiple live OIDC IdPs can be enabled at once and selected per org. `GET /api/v1/auth/oauth2/start?providerId=github` uses `oauth4webapi` Authorization Code + PKCE, verified email lookup, optional allowed-domain/org/team/admin-team policy, durable mapped-group sync for known Romeo groups, and the normal hashed `rms_` session cookie. `POST /api/v1/auth/ldap/login` uses `ldapts` with LDAPS or StartTLS-required LDAP, bounded service bind/search, user bind verification, optional domain/group/admin policies, durable mapped-group sync for known Romeo groups, and the normal hashed `rms_` session cookie. `GET /api/v1/auth/saml/start`, `POST /api/v1/auth/saml/callback`, and `GET /api/v1/auth/saml/metadata` use `@node-saml/node-saml` for SP-initiated SAML login, signed assertion validation, optional signed response enforcement, request replay protection through bounded `system_settings` state plus an HttpOnly state cookie, managed IdP certificate refs, mapped-group sync for known Romeo groups, admin-group promotion, and metadata-only audit. Optional SCIM v2 Users/Groups lifecycle endpoints are implemented behind `SCIM_ENABLED=true`, require admin-scoped Romeo authentication, return raw SCIM JSON, deactivate users with credential revocation instead of destructive user delete, and delete groups only after transactional membership cleanup plus group-principal grant revocation. `POST /api/v1/admin/directory-sync` provides a guarded admin-only preview/apply boundary for destructive directory lifecycle reconciliation, including missing-user disable, stale group-membership removal, confirmation-gated apply, admin/current-caller preservation defaults, cap enforcement, credential revocation through existing user disable, and redacted metadata-only output/audit. `pnpm smoke:directory-sync:contract` now gives that route a reusable local evidence artifact for unauthenticated denial, preview/apply guardrails, admin/current-caller preservation, stale membership cleanup, disabled-user credential revocation, and raw-directory-value redaction. `pnpm evidence:identity-live`, `IDENTITY_LIVE_EVIDENCE_PATH`, `GET /api/v1/admin/identity/live-posture`, and `client.admin.identityLivePosture()` now provide metadata-only mounted readback for reviewed target identity evidence covering live managed secret backends, configured IdP login, directory lookup, group/workspace mapping, directory-sync preview/apply, deprovisioning or SCIM lifecycle, access-review readback, and log/evidence redaction without returning mounted paths, provider endpoints, directory entries, LDAP DNs, SAML assertions, group names, email addresses, secret refs, token values, provider responses, or evidence bodies. Target identity evidence can now be promoted to a strict optional Phase 23 GA gate with `pnpm ga:checklist -- --require-identity-live` / `GA_REQUIRE_IDENTITY_LIVE=true`, and `pnpm ga:target-preflight` maps it to `IDENTITY_LIVE_EVIDENCE_REVIEWED=true pnpm evidence:identity-live -- --output dist/ci/identity-live-evidence.json` before reporting readiness. `GET /api/v1/admin/readiness` now checks local MFA encryption-key posture, locally managed secret encryption-key posture for `romeo-secret://` refs, local fallback posture, enabled OIDC provider config completeness, disabled resolver posture for configured external provider secret refs, and corrupted invalid provider secret-ref schemes without returning raw config. OIDC discovery and browser token-response validation use `openid-client`; GitHub OAuth2 uses `oauth4webapi`; LDAP/AD uses `ldapts`; SAML uses `@node-saml/node-saml`; local passwords use `@node-rs/argon2` Argon2id PHC hashes with legacy scrypt verification/rehash compatibility, and local MFA uses `otplib` with encrypted TOTP secrets plus recovery codes stored only as encrypted salted-hash envelopes. Live Vault/directory/IdP validation, live enterprise directory-sync validation against customer policies, and deeper live provider validation beyond implemented OIDC/GitHub/LDAP/SAML/SCIM flows remain target-environment execution backlog.

Service-layer role checks now use explicit `global_admin`/`org_admin` helpers for cross-org decisions rather than broad `isAdmin` shortcuts. Org admins retain admin behavior inside their own org, while cross-org resource/list access requires `global_admin`; focused authorization tests cover guessed-workspace cross-org denial for chats, runs, agents, knowledge bases, and service-account management, plus explicit global-admin override behavior.

Latest validation: the auth-provider acceptance contract passed with all 11 implemented providers enabled and connection-tested: local, generic OIDC, Keycloak, Google, Azure AD/Entra ID, Okta, Auth0, GitHub, LDAP, Active Directory, and SAML. The evidence shows every provider test status as `passed`, records 12 OIDC discovery/JWKS fetches for six OIDC-family providers, records two LDAP binds for LDAP plus Active Directory, and keeps issuer paths, client IDs, secret refs, secret values, directory DNs, identity groups, and provider responses redacted. Focused API coverage now also proves `startOidcLogin({ providerId, orgId, returnTo })` selects org-scoped OIDC settings, signs the org/provider in PKCE state, completes callback against the same org, provisions the user into that org, and exposes `orgId`/`providerId` in sanitized start readback for the frontend SDK. The Compose auth fallback slice now also proves recovery-code generation, recovery-code challenge login, reused-code rejection, remaining-code status readback, audit/log redaction for recovery-code values, and Docker runtime availability for externalized `@node-rs/argon2` through the app dependency graph. Focused Prettier, script syntax checks, focused app check/build, backend package checks/tests, OpenAPI route coverage, SDK drift, docs command-check, Docker Compose config render, offline Kubernetes render smoke, DB generate no-op, strict greenfield baseline review, broad `pnpm build`, and live `pnpm smoke:compose:auth -- --output dist/ci/compose-auth-smoke-mfa-recovery-codes.json` through the shared auth helper passed. Current broad `pnpm check`, `pnpm lint`, and `pnpm test` are blocked by app-layer `BillingPanel.tsx` typing and workflow-mutation test failures outside this backend slice. The migration inventory remains only `0000_greenfield_baseline.sql` plus Drizzle metadata.

Scope details:

- Provider catalog entries must be stable IDs with protocol, runtime package, implementation status, supported scopes, JIT support, local-fallback support, MFA delegation posture, and sanitized notes.
- Implemented package-backed providers: local auth through `@node-rs/argon2`, Node `crypto`, and `otplib`, OIDC-family discovery and PKCE callback token-response processing through `openid-client` for generic OIDC, Keycloak, Google, Azure AD/Entra ID, Okta, and Auth0, GitHub direct OAuth2 through `oauth4webapi`, LDAP/Active Directory through `ldapts`, and SAML through `@node-saml/node-saml`.
- Planned package-backed providers: none in the current catalog; future providers must land with the same settings, secret-ref, audit, test, and redaction contracts before being marked implemented.
- Configuration model must support one global default provider policy for single-org installs and optional per-org enablement/overrides for multi-org installs.
- Implemented OIDC provider config must allow distinct issuer URL, client ID, group claim, admin group, group map, workspace group map, and workspace prefix per provider without adding migration churn before the baseline lock.
- Provider secrets must remain managed `secretRef` pointers; the audited ingestion path may return local `romeo-secret://...` refs or Vault-backed `vault://...` refs, and frontend brand icons should remain static assets keyed by `providerId`, not backend-returned blobs.
- The frontend should show implemented providers as configurable, planned providers as disabled/coming-soon, and all provider details without exposing issuer URLs, client IDs, bind DNs, secrets, token claims, or JWKS URLs to unauthorized users.

Tasks:

- Keep `GET /api/v1/admin/auth-providers/catalog` additive and covered by OpenAPI, SDK, and API tests.
- Maintain `GET/PATCH /api/v1/admin/auth-providers/settings` coverage for persisted global provider settings with provider enablement, display posture, login ordering, allowed domains, org-override policy, disabled-state reason codes, per-provider OIDC connection config, and managed secret refs.
- Maintain sparse persisted org-level auth-provider overrides that can enable/disable an allowed global provider, override non-secret mapping fields, override per-provider OIDC connection config, and point secret material only at managed secret refs.
- Maintain `POST /api/v1/admin/secrets` coverage for encrypted local `romeo-secret://` creation, Vault-backed `vault://` writes, redacted audit metadata, and no raw value readback; keep external secret-manager refs valid for deployments that manage secrets outside Romeo.
- Maintain `POST /api/v1/admin/secret-rotation/rewrap/preview` and `/api/v1/admin/secret-rotation/rewrap` coverage for staged previous-key rewrap of local MFA and local managed-secret envelopes, including org-scope defaults, global-managed-secret admin gating, explicit confirmation, no raw secret/ref/key readback, and metadata-only audit summaries.
- Maintain `TENANCY_MODE` bootstrap coverage so frontends can hide global/org switchers in single-tenant deployments without build-time guessing.
- Maintain the concrete `/me` `BootstrapResponse` OpenAPI contract for `deployment.tenancyMode` so generated clients and frontend agents can discover the deploy-time posture.
- Maintain `GET /api/v1/auth/oidc/start?providerId=...&orgId=...` runtime coverage so browser PKCE login and callback validate against the selected global or org-scoped provider's stored OIDC config.
- Maintain `GET /api/v1/auth/oauth2/start?providerId=github` and `/api/v1/auth/oauth2/callback` runtime coverage so GitHub direct login uses its stored OAuth2 policy, managed secret refs, verified email/org/team checks, durable known-group sync, and metadata-only audit without reusing delegated connector OAuth tokens.
- Keep last-admin-path and local-fallback protection on provider setting updates, including repeated confirmation before disabling local auth fallback.
- Maintain metadata-only audit summaries for provider setting updates: changed provider IDs and category arrays are allowed, but display names, domains, issuer URLs, client IDs, secret refs, raw secret values, and token/JWKS material must stay out of audit logs.
- Maintain readiness checks for missing local fallback, unsafe local MFA encryption keys, unsafe managed-secret encryption keys when `romeo-secret://` refs are configured, incomplete enabled OIDC provider config, disabled secret-resolution posture for configured external provider secret refs, and invalid persisted provider secret-ref schemes.
- Keep explicit `POST /api/v1/admin/sso-settings/test` and `POST /api/v1/admin/auth-providers/settings/test` coverage for live OIDC discovery/JWKS failures so readiness does not hang on external IdP calls.
- Maintain package-backed OIDC discovery, browser token-response processing, issuer/audience/nonce/time validation, and Romeo claim mapping without reintroducing local protocol parsing.
- Keep direct GitHub login separate from delegated connector OAuth; do not mix connector OAuth tokens into login identity records.
- Maintain LDAP/AD with StartTLS/LDAPS by default, bounded search filters, bind-secret refs, group mapping, lockout controls, no password capture beyond the provider bind attempt, and live enterprise-directory validation before claiming deployment-specific completion.
- Maintain SAML with signed-assertion requirements, optional signed-response enforcement, metadata/ACS setup docs, replay protection, NameID/email collision policy, and live IdP validation evidence before declaring a deployment GA-ready.
- Maintain local login success/failure, unknown-principal aggregation, and MFA enrollment/confirmation/disable audit coverage using metadata-only payloads; unknown-principal rows must stay under disabled per-org system actors and store keyed identifier hashes rather than raw identifiers. Provider setting enable/disable and mapping changes are covered by `admin.auth_provider_settings.update` change summaries, and role changes already revoke credentials with sanitized user/role metadata.
- Keep public webhook and anonymous/system audit actors backed by disabled per-org user rows so the Postgres audit foreign-key contract remains valid without adding noisy migration churn or login-capable system principals.
- Add UI handoff examples for the provider app-store page: list catalog, show current global/org status, configure provider, test connection, enable/disable, and show fallback warnings.

Definition of done:

- Admins can view an enterprise provider catalog and distinguish implemented, configured, misconfigured, disabled, and planned providers.
- Single-org installs can use global provider config without per-org setup.
- Multiple implemented OIDC-family provider cards can be live at once with different issuers and client IDs.
- Multi-org installs can constrain provider availability and overrides per org without leaking config across orgs.
- Local password auth, local TOTP MFA, and one-time recovery codes remain available as explicit fallback when SSO is unavailable, unless a global admin deliberately disables them with another active admin path.
- Global admins can promote/revoke global admins; org admins can manage org-scoped roles only where policy allows.
- Every provider setting API has OpenAPI, TypeScript SDK, generated Python SDK, authorization tests, audit tests, and redaction tests.

Testing:

- API tests for catalog readback, global setting updates, org override updates, per-provider OIDC config readback, provider-selected PKCE login, future planned-provider blocking, last-admin-path protection, provider connection-test success/failure classes, staged secret-envelope rewrap, and unauthorized tenant access.
- Unit tests for provider-package adapters: `openid-client` discovery/token validation, GitHub OAuth exchange, LDAP/AD bind/search mapping, and SAML assertion validation.
- Negative tests for issuer/subject/email collision, cross-org subject reuse, disabled provider login, disabled user login, missing MFA factor, invalid TOTP code, locked local password, and stale MFA challenge token.
- SDK tests for every new endpoint and response shape.
- Baseline review should continue proving provider settings do not create migration churn while they remain backed by `system_settings`; migration tests are required only if future provider-specific tables are added.

Validation and evidence:

- `pnpm --filter @romeo/core check`
- `pnpm --filter @romeo/core test`
- `pnpm --filter @romeo/api-client test -- src/client.test.ts`
- `pnpm check:sdk-drift`
- `pnpm check:openapi-route-coverage`
- `pnpm review:baseline -- --strict` before any pre-GA baseline fold-in, or forward-migration review after baseline release.
- `pnpm smoke:compose:auth -- --output dist/ci/compose-auth-smoke.json` for local password login, TOTP enrollment/login, one-time recovery-code generation/use/reuse rejection, SSO-unavailable local fallback, `/me` tenancy readback, audit redaction, and Compose log redaction.
- Live IdP smoke with externally injected OIDC/GitHub/LDAP/SAML provider secrets, redirect URL validation, real provider login, and pod-log redaction for provider secrets and raw claims.
- Kubernetes live smoke with externally injected provider secrets, redirect URL validation, real provider login where the target IdP is approved, and pod-log redaction for provider secrets and raw claims.

Compose and Kubernetes impact:

- Compose `.env.example` must document `LOCAL_AUTH_SECRET_ENCRYPTION_KEY`, `LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS`, `MANAGED_SECRET_ENCRYPTION_KEY`, `MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS`, OIDC defaults, redirect URLs, and local-fallback policy.
- Helm values must keep provider secrets in Secret or External Secrets references, expose staged previous-key values only through secret env during rotation windows, and support both global and org-scoped config without changing the app contract.
- CloudNativePG and external hosted Postgres remain compatible because provider settings use the same `DATABASE_URL`, migration job, backup/restore, and schema validation paths.

Security and migration notes:

- Do not store raw SSO client secrets, LDAP bind passwords, SAML private keys, token bodies, TOTP plaintext secrets, or local passwords outside encrypted secret envelopes or approved external secret managers.
- Local TOTP and local `romeo-secret://` envelopes remain encrypted at rest and now have staged previous-key rewrap APIs/runbook coverage before live key rotation is advertised; rewrap evidence must store counts/failure codes only.
- Keep explicit `global_admin` and `org_admin` helper usage in service-layer authorization; org-admin cross-org shortcuts are blocked and covered by focused negative tests.
- Any new persistent provider-config tables after this pre-GA fold-in require forward-only migrations with upgrade tests; do not create corrective migration chains.

## HAM-P23-01: Account Linking And SCIM Decision

Phase: 23 Enterprise Identity And Lifecycle.

Depends on: existing OIDC bearer/browser PKCE foundation.

Goal: close identity lifecycle policy before enterprise rollout.

Current status: implemented as explicit account-linking-disabled policy plus optional SCIM v2 lifecycle support and guarded destructive directory sync. Account linking remains disabled in SSO posture, access-review policy, and `GET /api/v1/governance/identity-lifecycle-policy`. OIDC JIT provisioning fails closed when an incoming OIDC email collides with a different same-org local user or when the deterministic issuer/subject user ID is already owned by another org; focused API tests cover those identity-collision paths. The lifecycle policy endpoint reports SCIM as `disabled` by default and `enabled` with `User` and `Group` resources when `SCIM_ENABLED=true`. SCIM endpoints are raw `/api/v1/scim/v2` resources that require admin-scoped Romeo authentication, support user/group create, replace, patch, list, and read, map user delete to deactivation plus credential revocation, and map group delete to membership cleanup, group-principal grant revocation, metadata-only audit, and group removal. `POST /api/v1/admin/directory-sync` is the separate admin-only preview/apply boundary for missing-user disable and stale group-membership removal; apply requires explicit confirmation, caps destructive changes, preserves the caller and admins by default, and returns/audits metadata-only results.

Latest validation: the identity lifecycle and directory-sync slice passed focused Prettier, `@romeo/core` and `@romeo/api-client` checks/tests, Python SDK drift at 357 operations, no-op `@romeo/db db:generate`, Postgres schema dry-run validation, Compose config render with and without the workers profile, docs command-check, strict greenfield baseline review, repository conformance review, Kubernetes render smoke, broad `pnpm check`, `pnpm lint`, `pnpm test`, `pnpm build`, and GA evidence-contract smoke. Evidence files were written to `dist/ci/docs-command-check-directory-sync.json`, `dist/ci/greenfield-baseline-directory-sync.json`, `dist/ci/repository-conformance-directory-sync.json`, `dist/ci/kubernetes-render-directory-sync.json`, and `dist/ci/ga-checklist-directory-sync.json`. The GA checklist remains blocked only by target-environment execution, not by the directory-sync API.

Scope details:

- Decide whether local accounts can link to external identities.
- Keep SCIM opt-in per deployment through `SCIM_ENABLED` until a target IdP lifecycle client is approved.
- Define source-of-truth behavior across local admin edits, OIDC mapped groups, optional SCIM, and guarded batch directory sync.

Tasks:

- Maintain account-linking policy with default disabled state in SSO posture, access review, and the identity lifecycle policy API.
- Add tests for issuer/subject/email collision behavior. Initial email and cross-org issuer/subject collision tests now pass.
- Maintain SCIM supported resources as `User` and `Group` only when `SCIM_ENABLED=true`; disabled deployments must report no supported SCIM resources and return SCIM-shaped disabled errors.
- Maintain managed group and membership semantics in the lifecycle policy API: local admin is authoritative, OIDC group sync is additive for known groups, unknown external groups are ignored, destructive membership sync is not automatic, and guarded batch cleanup runs only through `POST /api/v1/admin/directory-sync`.
- Maintain `POST /api/v1/admin/directory-sync` as the only destructive batch directory reconciliation boundary, with preview default, explicit apply confirmation, count caps, admin/current-caller preservation, redacted output, and metadata-only audit.
- Document deprovisioning precedence and destructive-change safeguards.

Definition of done:

- Account linking is either implemented behind policy or explicitly disabled.
- SCIM is implemented behind explicit config and documents destructive-change safeguards.
- Destructive user-disable and group-membership cleanup are available only through guarded preview/apply sync with redacted evidence and no automatic background deletes.
- Identity collisions fail closed.

Testing:

- OIDC issuer and subject collision tests.
- Account link/unlink tests if enabled.
- SCIM create/update/patch/deactivate, group membership, disabled-flag, audit-redaction, and group-delete cleanup tests.
- Directory-sync preview/apply tests for missing-user disable, stale group-membership removal, missing confirmation, admin preservation, current-caller preservation, cap enforcement, credential revocation, and redacted API/audit output.
- Group mapping drift tests.

Validation and evidence:

- Identity lifecycle policy API and document.
- Test evidence for collision, deprovisioning, SCIM user deactivation, guarded directory sync, credential revocation, group membership cleanup, group-principal grant revocation, and audit-redaction behavior.

Compose and Kubernetes impact:

- Compose and Kubernetes docs must describe OIDC redirect URLs, group mapping, source-of-truth selection, guarded directory sync, and lifecycle limitations.

Security and migration notes:

- Do not add SCIM-specific tables unless future managed-by-SCIM ownership semantics require them; the current optional SCIM surface uses existing users, groups, memberships, sessions, API keys, and audit records without migration churn.
- Do not persist raw directory payloads, external identifiers, group names, reason text, or target inventories in directory-sync audit records; keep the current greenfield implementation on existing users, groups, memberships, sessions, API keys, and audit records unless a future managed-ownership model proves it needs a forward-only schema addition.

## HAM-P23-02: Enterprise Access Review And Support Lifecycle Closure

Phase: 23 Enterprise Identity And Lifecycle.

Depends on: current access review and support impersonation foundation.

Goal: make enterprise access reviews and support access evidence complete enough for regulated deployments.

Current status: mostly implemented at the application contract. Romeo now exposes a broad redacted enterprise access review report through `GET /api/v1/access-review/report`, `GET /api/v1/access-review/report.csv`, `client.governance.accessReviewReport(...)`, and `client.governance.accessReviewReportCsv(...)`. The report covers users, groups, memberships, service accounts, active credential/session counts, resource grants, data connector ownership, delegated OAuth connection posture, tool connector risk, worker job counts, support approval/session posture, and explicit identity policy posture while omitting API key hashes, session hashes, support reason text, connector configs, secret refs, OAuth token envelopes, background job payloads, and tool payloads. Support sessions are explicitly revocable through `POST /api/v1/admin/impersonation/sessions/{sessionId}/revoke` and `client.sessions.revokeSupportSession(...)`, with sanitized `support.impersonation.revoke` audit evidence and backing token invalidation. User disable now revokes the disabled user's API keys and local sessions, revokes active support impersonation sessions created or requested by that user, rejects support impersonation targeting disabled users, and rejects approval of pending support requests whose requester was disabled after request creation. Support bundles now cross-link access-review report evidence by schema/path/hash/status metadata without embedding report bodies. Focused API and SDK tests cover redaction, revocation, token invalidation, disabled-user credential revocation, and disabled-requester approval denial; support-bundle redaction smoke covers access-review evidence links. Remaining work is any deployment-specific access review classes and final regulated-deployment evidence.

Scope details:

- Access review exports for users, groups, workspace grants, service keys, support approvals, connector ownership, and risky worker permissions.
- Support access windows, approvals, revocation, expiry, and per-request audit evidence.

Tasks:

- Review access review export coverage against enterprise requirements.
- Add missing resource classes or documented exceptions.
- Maintain support access expiry, revocation, disabled-requester, and disabled-owner negative tests.
- Maintain support bundle links to access review evidence without including report bodies or secrets.
- Document break-glass as unsupported unless policy explicitly accepts it.

Definition of done:

- Admins can export current access posture without secret exposure.
- Support sessions are time-bound, approved, audited, and revocable.
- Disabled users cannot keep sessions, keys, or support-derived access.

Testing:

- Access review redaction tests.
- Support approval, denial, expiry, revocation, and request-audit tests.
- Disabled-user session/key/support-session negative tests.

Validation and evidence:

- Redacted access review export.
- Support lifecycle test report.
- Support bundle redaction evidence with access-review evidence link coverage.

Compose and Kubernetes impact:

- Behavior is application-level and identical across Compose and Kubernetes.

Security and migration notes:

- Support reasons and ticket content remain hashed or metadata-only unless policy changes.
