# Backlog Track: Enterprise Operations

This track makes Romeo deployable and operable in enterprise environments without losing the Docker Compose path. Kubernetes must be production ready, but not required for local or small self-hosted installs.

Concrete execution tickets for Phase 21, Phase 22, and Phase 23 live in [Enterprise Platform](./execution/enterprise-platform.md).

## Phase 21: Kubernetes Enterprise Platform

### Objective

Turn the Helm chart into a production deployment surface that supports CloudNativePG-managed Postgres, externally hosted Postgres, external Valkey, S3-compatible storage, secure secrets, workers, observability, backup/restore, and controlled upgrades.

### Scope

- Helm chart and values schema.
- App deployment and migration job.
- Worker deployments and CronJobs.
- Optional KEDA ScaledJob examples for durable due-work classes.
- Guarded live namespace smoke through `pnpm smoke:kubernetes:live`.
- CloudNativePG optional deployment contract.
- External hosted Postgres contract.
- NetworkPolicy, RBAC, security contexts, PDBs, autoscaling hooks, ingress, TLS, and observability.
- Backup, restore, DR drill, and upgrade runbooks.

### Tasks

1. Helm values contract:
   - Add a documented values schema for app, workers, ingress, secrets, Postgres, Valkey, object storage, OIDC, providers, feature flags, resources, probes, network policy, telemetry, and backup.
   - Define `postgres.mode` as `external`, `cloudnativepg`, or `disabled`.
   - Keep the application contract identical across Postgres modes: `DATABASE_URL`, migration job, pgvector readiness, backup command, restore command, and DR drill.
   - Add `global.production=true` style guardrails that disable seeded login and require durable storage.

2. External Postgres mode:
   - Accept `DATABASE_URL` from an existing Secret or External Secrets-managed Secret.
   - Document required extensions, minimum Postgres version, TLS requirements, connection limits, pool sizing, backup owner expectations, and restore expectations.
   - Add readiness checks for connectivity, migration state, and pgvector.
   - Document managed-service examples for common providers without baking provider-specific logic into the app.
   - Ensure no Helm template assumes Postgres runs in-cluster when external mode is selected.

3. CloudNativePG mode:
   - Provide optional example values or templates for a CloudNativePG cluster.
   - Use a pgvector-capable image or documented extension installation path.
   - Separate roles for owner, app runtime, migration job, and backup where supported.
   - Configure WAL archive and scheduled backups through CloudNativePG-compatible object storage.
   - Document restore into a replacement cluster.
   - Document how to promote from Compose Postgres to CloudNativePG, and from CloudNativePG to external hosted Postgres.
   - Keep CloudNativePG templates optional so users with an existing operator can manage the cluster separately.

4. App deployment:
   - Add Deployment, Service, ServiceAccount, ConfigMap, Secret references, probes, resources, topology spread, security context, and graceful shutdown.
   - Use readiness to block traffic when critical configuration is unsafe.
   - Add liveness only for process health, not dependency health.
   - Use startup probes for slow migrations or cold provider discovery where needed.
   - Mount no broad secret volumes by default.

5. Migration job:
   - Run migrations as a Helm hook or separately documented pre-upgrade job.
   - Use the same command as Compose.
   - Fail closed on missing pgvector, drifted schema, unsafe production config, or unsupported baseline version.
   - Record migration logs without printing connection strings.
   - Document rollback constraints after schema changes.

6. Workers and schedulers:
   - Add templates or examples for connector sync, knowledge extraction, voice catalog sync, workflow resume, notification delivery retry, webhook retry, retention/deletion, Postgres backup, tool dispatch, and browser automation.
   - Prefer separate worker service accounts and Secret scopes.
   - Give each worker independent resources, concurrency, timeout, and retry configuration.
   - Use CronJobs for polling work until a durable queue worker is implemented.
   - Use optional KEDA ScaledJobs only when due-work queries, one-shot worker commands, idempotency, and Secret boundaries are reviewed.
   - Set `concurrencyPolicy: Forbid` where duplicate execution would be unsafe.
   - Add `activeDeadlineSeconds` and failed job history limits.

7. Optional long-running workers:
   - Define Deployment or CronJob patterns for out-of-process tool execution and browser automation workers.
   - Require explicit feature flags, network egress allowlists, Secret scopes, object-store artifact paths, and resource limits.
   - Keep risky workers out of the default chart path.

8. Network and pod security:
   - Add default-deny NetworkPolicies with documented egress openings for Postgres, Valkey, object store, OIDC issuer, provider APIs, connector allowlists, notification providers, and telemetry.
   - Add restricted pod security settings: non-root, no privilege escalation, dropped capabilities, read-only root filesystem where feasible, and `RuntimeDefault` seccomp.
   - Add RBAC with minimum service account permissions.
   - Make all hostPath, privileged, and broad egress settings opt-in and documented as exceptional.

9. Availability and scaling:
   - Add PDBs for app and long-running workers.
   - Add HPA values for app and eligible workers.
   - Document KEDA hooks only for durable due-work classes with reviewed one-shot worker commands, idempotency, and Secret boundaries.
   - Define request and limit defaults.
   - Document connection-pool and worker-concurrency formulas relative to Postgres limits.
   - Add graceful drain behavior for app and workers.

10. Observability:

- Wire structured logs with request IDs, org IDs, workspace IDs, and job IDs where safe.
- Add OpenTelemetry endpoint configuration.
- Add Prometheus scrape annotations or ServiceMonitor option.
- Track readiness findings, request latency, run latency, provider errors, worker lag, job failures, notification failures, webhook failures, connector sync outcomes, Postgres backup status, and billing webhook failures.
- Add dashboards or dashboard JSON once metrics names stabilize.

11. Backup, restore, and DR:

- Document backup schedules for external Postgres and CloudNativePG.
- Add object-store backup expectations for artifacts if the store is not already durable.
- Provide restore runbook for database plus object store, including ordering: restore objects, restore Postgres, validate schema, then start app traffic.
- Add DR drill script path that validates a restored environment without hitting real external providers.
- Verify restored database rows still reference existing object-store artifacts through authenticated Romeo API reads.
- Define recovery point objective and recovery time objective targets per deployment class.

12. Upgrade and rollback:

- Document pre-upgrade backup, migration dry run, app rollout, readiness verification, and worker restart order.
- Add Helm upgrade smoke test.
- Document rollback limits after schema migrations.
- Add chart versioning and app version pinning.
- Keep image tags explicit.

### Definition Of Done

- Helm chart can deploy app, migration job, workers, and required configuration in a production namespace.
- Both CloudNativePG-managed and external hosted Postgres modes are documented and validated against the same app contract.
- Critical readiness findings block production traffic.
- Default chart posture is compatible with restricted Kubernetes environments.
- Worker templates have scoped secrets, bounded resources, and sanitized logging.
- Backup, restore, and DR drill instructions exist for both Postgres modes.
- Object-store backup, restore, and DR drill instructions exist for S3-compatible artifact stores.
- Compose and Kubernetes use the same migration and validation commands.

### Testing

- Helm template tests for all supported values combinations.
- Chart lint and schema validation.
- `pnpm smoke:kubernetes:live` against a reachable local or staging cluster where practical.
- External Postgres integration test with a non-cluster Postgres endpoint.
- CloudNativePG render and documentation validation; full e2e where an operator is available.
- Offline CloudNativePG operator-example validation through `pnpm smoke:kubernetes:render`.
- Explicit NetworkPolicy egress render validation through `deploy/helm/networkpolicy-egress-values.example.yaml`.
- NetworkPolicy negative tests for blocked egress where the test harness supports it.
- Readiness tests for missing secrets, seeded login in production, missing pgvector, failed migration state, missing object store, and unsafe worker flags.
- Backup/restore runbook test.
- Object-store restore drill with manifest SHA-256 verification.

### Validation

- `helm template` renders with external Postgres and CloudNativePG values.
- `pnpm smoke:kubernetes:live` emits `romeo.kubernetes-live-smoke.v1` evidence when a live cluster is available.
- `pnpm smoke:kubernetes:render` validates the CloudNativePG operator examples and app Secret contract.
- `pnpm smoke:kubernetes:render` validates deny-all and explicit-egress NetworkPolicy variants.
- Migration job runs before app readiness in a clean namespace.
- App and worker pods run as non-root with restricted security contexts.
- Logs do not include connection strings, bearer tokens, provider keys, raw prompts, or raw payloads.
- DR drill proves a restored environment can pass readiness and serve existing persisted database records and object-store artifacts.

## Phase 22: Release, CI, And Supply Chain

### Objective

Build a release pipeline that produces verifiable packages, images, SDKs, Helm artifacts, SBOMs, security evidence, and publish readbacks.

Current status: CI foundations are implemented in `.github/workflows/ci.yml` for changed-file formatting, OpenAPI/Python SDK drift, typecheck, tests, build, baseline and repository coverage review, branch-protection plan generation, background job lag smoke, provider resilience smoke, backup upload-failure smoke, live pgvector migration/schema/conformance, Helm render smoke, release-evidence dry run with release provenance, air-gapped bundle verification, planned readback validation, analytics authorization contract smoke, auth-provider acceptance contract smoke, data connector acceptance contract smoke, operational monitoring contract validation, alert firing contract smoke, edge enforcement contract smoke, GA evidence contract smoke, and serialized Compose smoke jobs. Offline release evidence generation, provenance validation, protected-approval evidence validation, branch-protection plan generation, read-only hosted CI run verification tooling, read-only hosted branch-protection verification tooling, air-gapped bundle verification with readback-validation linkage, and readback mismatch failure-injection are locally validated. Protected credentialed publish, live hosted release approval execution, live staging readback collection, release-environment signed/attested provenance attachment, executing the hosted CI run verifier and read-only branch-protection verifier against the selected repository after settings are applied, and immutable promotion evidence remain open.

### Scope

- Branch protection and CI.
- Test matrix for app, packages, SDKs, CLI, database, Compose, Helm, and security evidence.
- Container, package, and chart publication.
- Release approvals, provenance, SBOM, vulnerability scanning, and rollback metadata.
- Credentialed publish plan execution and readback verification.

### Tasks

1. CI foundations:
   - Run lint, typecheck, unit tests, integration tests, SDK generation checks, OpenAPI drift checks, and formatting checks.
   - Run Postgres integration tests with pgvector.
   - Run repository conformance tests against Postgres.
   - Run auth and authorization negative tests.
   - Run redaction tests for logs, audits, jobs, and usage metadata.

2. Deployment artifact checks:
   - Build app and worker images.
   - Run container startup smoke tests.
   - Render and lint Helm chart.
   - Run Compose config and smoke tests.
   - Generate and validate release channels.
   - Generate Python SDK and TypeScript SDK artifacts from OpenAPI.

3. Supply chain evidence:
   - Generate CycloneDX SBOM.
   - Generate container scan plan and ingest scan results.
   - Generate provenance for packages and containers where the registry supports it.
   - Sign images and release artifacts where signing infrastructure exists.
   - Store release evidence with immutable artifact references.

4. Publish workflow:
   - Require protected release approval before publishing.
   - Publish npm packages, Python package, container images, Helm chart, and release bundle according to the release plan.
   - Read back package versions, image digests, chart versions, and release metadata after publishing.
   - Fail the release if any readback does not match the planned artifact digest or version.
   - Produce rollback instructions tied to immutable image digests and chart versions.

5. Credential handling:
   - Use least-privilege release credentials.
   - Separate staging and production publish credentials.
   - Keep credentials in CI secret storage only.
   - Do not echo tokens, registry passwords, provenance private keys, or signing material.
   - Rotate credentials on a documented schedule.

6. Air-gapped and private release:
   - Produce a release bundle with images, Helm chart, SBOM, checksums, signature metadata, and upgrade notes.
   - Verify mirrored bundle contents with `pnpm release:airgap-check`, adding `--require-readback-validation` for final promotion, before transfer and after import into the disconnected repository.
   - Document private registry mirroring.
   - Provide verification commands for disconnected environments.
   - Keep air-gapped publication separate from public SaaS release promotion.

### Definition Of Done

- CI blocks merges on lint, typecheck, tests, OpenAPI drift, SDK drift, migration validation, and security evidence generation.
- Branch-protection plan evidence lists the required status checks and review policy before hosted repository settings are applied.
- Hosted CI run evidence proves the selected or latest completed GitHub Actions workflow run succeeded with every planned required check present and successful.
- Release plan can be executed with credentials in CI.
- Published artifacts are read back and verified.
- Images and packages have SBOM and scan evidence.
- Helm and Compose artifacts are tested before release.
- Rollback metadata is included in each release.

### Testing

- Pull request CI test suite.
- `pnpm smoke:ci:hosted-run-contract` and `pnpm ci:hosted-run-verify -- --dry-run` for local hosted-run evidence contract coverage.
- Release candidate dry run without publishing.
- Staging publish to non-production registries.
- Production publish readback.
- Failure injection for missing readback, mismatched digest, failed scan, and missing approval.
- Air-gapped bundle verification in a clean environment.

### Validation

- A release artifact manifest lists immutable digests for every published artifact.
- Air-gapped bundle verification evidence records package tarball, SBOM, channel, security, provenance, optional GA bundle, and optional publish-plan linkage without artifact bodies or secrets.
- Readback evidence matches the manifest.
- Security evidence is present before promotion.
- Upgrade check passes against the release channel.
- Documentation points to exact image tags and chart versions, not floating tags.

## Phase 23: Enterprise Identity And Lifecycle

### Objective

Close enterprise identity lifecycle evidence around the implemented local-auth, SSO, directory, SCIM, access-review, and provider app-store backend contract without weakening the local fallback path.

Current status: backend/API support is implemented for local password auth with TOTP MFA and one-time recovery codes, local and SSO user promotion to org/global admin, browser OIDC PKCE with per-provider issuer/client/claim settings, GitHub direct OAuth2 PKCE, direct LDAP/Active Directory login, direct SAML login, managed auth-provider secret ingestion through local encrypted refs or Vault refs, provider-card connection tests, explicit account-linking-disabled policy, optional SCIM v2 Users/Groups lifecycle, guarded directory-sync preview/apply, redacted enterprise access review, identity lifecycle policy reporting, and `TENANCY_MODE=single|multi` readback on `/api/v1/me`. `pnpm smoke:auth-providers:acceptance-contract` proves the local catalog/settings/test/secret-ingestion contract with metadata-only evidence. Remaining Phase 23 work is live customer IdP/directory/Vault evidence, enterprise group lifecycle validation under real policies, and any future destructive managed-directory policy only after explicit product approval.

### Scope

- Keep local auth, TOTP MFA, and one-time MFA recovery codes available as a deployment-controlled fallback unless explicitly disabled with confirmation.
- Keep provider catalog/settings/test APIs stable for the frontend app-store-style auth configuration surface.
- Maintain per-provider OIDC, GitHub OAuth2, LDAP/AD, and SAML settings instead of a shared single-IdP connection.
- Maintain managed-secret ingestion and sanitized `secretRef` posture for admins who paste secrets through the UI or reference externally managed Vault/env secrets.
- Maintain explicit account-linking-disabled semantics unless a reviewed linking policy is accepted.
- Keep optional SCIM v2 Users/Groups lifecycle behind `SCIM_ENABLED=true`.
- Validate group lifecycle, workspace mapping, deprovisioning, access review, and support policy against real enterprise directories.
- Collect deployment-specific SAML, LDAP, Active Directory, OIDC, GitHub, Vault, and SCIM evidence without returning raw identity data or secrets.

### Tasks

1. Local auth and MFA fallback:
   - Keep Argon2id local password storage, TOTP enrollment/verification, one-time recovery-code generation/use, local session minting, and local password/MFA self-service covered by tests.
   - Keep `PATCH /api/v1/me` available for self-service name/email edits without requiring admin-only user modification.
   - Keep role promotion APIs able to promote local and SSO-created users to org admin or global admin through the same authorization helpers.
   - Ensure disabling local fallback requires explicit confirmation, is audited, and does not strand deployments without a working admin path.
   - Keep local MFA envelope rewrap evidence current when `LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS` is staged.

2. Provider app-store contract:
   - Maintain `GET /api/v1/admin/auth-providers/catalog` with implemented local, generic OIDC, Keycloak, Google, Azure AD/Entra ID, Okta, Auth0, GitHub, LDAP, Active Directory, and SAML entries.
   - Maintain `GET/PATCH /api/v1/admin/auth-providers/settings` for global defaults and org overrides in multi-tenant deployments.
   - Persist per-provider issuer URL, client ID, group claim, allowed domains, admin group/team mappings, workspace mapping hints, display name, ordering, enabled state, and sanitized `secretRef` posture.
   - Maintain `POST /api/v1/admin/auth-providers/settings/test` for metadata-only provider-card checks.
   - Keep provider-specific runtime packages isolated behind small service adapters: `openid-client`, `oauth4webapi`, `ldapts`, `@node-saml/node-saml`, `otplib`, Argon2id, and `node:crypto`.
   - Continue to reject raw client secrets, bind passwords, IdP certificates, provider responses, full issuer paths, LDAP DNs, SAML assertions, access tokens, and provider account IDs in API responses, audits, support bundles, and evidence.

3. Managed provider secrets:
   - Keep one-time admin secret ingestion through `POST /api/v1/admin/secrets`.
   - Store local managed secrets as encrypted `romeo-secret://` references without raw readback.
   - Support Vault-backed `vault://` references for deployments that require external secret custody.
   - Keep env-secret refs accepted for operator-managed deployments where UI secret ingestion is disabled.
   - Maintain metadata-only audit events and staged managed-secret rewrap evidence when `MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS` is configured.

4. Account-linking policy:
   - Keep local and external identities unlinked by default.
   - Reject OIDC subject collisions across organizations and reject email collisions while linking is disabled.
   - Do not attach an external identity to an existing local user without a future reviewed policy requiring verified email, explicit admin approval, audit, unlink, and recovery semantics.
   - Document any future linking mode as a separate product decision rather than an implicit SSO convenience.

5. SCIM or profile sync:
   - Keep SCIM opt-in through `SCIM_ENABLED=true` for deployments with an approved IdP lifecycle client.
   - Maintain SCIM ServiceProviderConfig, Schemas, ResourceTypes, Users, and Groups routes as raw `application/scim+json` responses.
   - Maintain create, replace, patch, list, read, deactivate, repeated-event, and invalid-auth behavior.
   - Require Romeo admin-scoped authentication for SCIM lifecycle clients.
   - Allow SCIM group delete only through the implemented transactional cleanup path that removes memberships, revokes group-principal grants, audits counts, and then removes the group.

6. Group and workspace lifecycle:
   - Maintain source-of-truth precedence across local admin edits, OIDC mapped groups, GitHub org/team policy, LDAP/AD groups, SAML groups, optional SCIM, and support-derived access.
   - Keep mapped external groups synced only into known Romeo groups unless a future auto-provisioning policy is approved.
   - Add or refresh drift reporting for missing mapped groups and workspace mappings where customer deployments need it.
   - Require admin review and explicit confirmation before destructive membership changes through directory sync.
   - Ensure disabled users lose sessions, API keys, support grants, and risky ownership paths where the current backend can safely transfer or block ownership.

7. Access review and support policy:
   - Maintain redacted exports for users, groups, workspace grants, service keys, support approvals, connector ownership, and identity source metadata.
   - Include review timestamps, retention metadata, and support-bundle links to access-review evidence.
   - Enforce time-bound support access with reason, ticket reference, approver, target scope, revocation audit, and disabled-requester checks.
   - Keep break-glass access out of scope unless explicitly accepted by enterprise policy.

8. Live enterprise evidence:
   - Run `pnpm smoke:auth-providers:acceptance-contract` in CI for local metadata-only coverage.
   - Collect deployment evidence against at least one real OIDC provider, one GitHub OAuth app if enabled, one LDAP/AD directory if enabled, one SAML IdP if enabled, one Vault-backed secret path if enabled, and one SCIM lifecycle client if enabled.
   - Confirm single-tenant and multi-tenant deployments surface the correct tenancy mode on `/api/v1/me` and enforce global/org provider scope behavior.
   - Validate customer-specific claim names, group names, admin mappings, workspace mappings, and deprovisioning policy with synthetic non-sensitive fixtures.

### Definition Of Done

- Local auth, TOTP MFA, one-time MFA recovery codes, self-service profile/password/MFA, and admin role promotion work for local and SSO-created users.
- Provider catalog/settings/test APIs are OpenAPI-documented, SDK-covered, and return sanitized connection summaries for every implemented provider family.
- Per-provider OIDC/OAuth2/LDAP/SAML settings support simultaneous live IdPs with different issuers, client IDs, claims, and policy maps.
- Managed auth-provider secrets use local encrypted refs or external secret refs without raw readback.
- Account linking remains explicitly disabled and documented unless a reviewed future policy is implemented.
- Optional SCIM behavior is implemented only behind explicit configuration and tests.
- Deprovisioning revokes sessions, keys, support grants, and risky ownership paths.
- Access review export exists and is redacted.
- Support access is time-bound, audited, and revocable.
- Live enterprise evidence exists for the enabled provider families in the target deployment.

### Testing

- Local auth, Argon2id password, TOTP MFA, one-time recovery-code generation/use/reuse rejection, self password/profile edit, and local fallback disable-confirmation tests.
- Org/global admin promotion tests for local users and SSO-created users.
- Auth-provider catalog/settings/test tests for local, generic OIDC, Keycloak, Google, Azure AD/Entra ID, Okta, Auth0, GitHub, LDAP, Active Directory, and SAML.
- Per-provider OIDC issuer/client/group claim tests, including multiple enabled OIDC providers with distinct issuer/client settings.
- GitHub OAuth2 policy tests for allowed domains, org/team constraints, admin-team promotion, PKCE callback replay rejection, and revoked or unavailable secrets.
- LDAP/AD tests for LDAPS or StartTLS-required LDAP, service bind/search, user bind verification, group mapping, required-group denial, and raw DN redaction.
- SAML tests for metadata, signed assertion validation, replay protection, group/admin mapping, and assertion/certificate redaction.
- Managed-secret tests for local encrypted storage, Vault-backed refs, env refs, secret-ref sanitization, and rewrap preview/apply.
- OIDC subject collision and issuer collision tests.
- Account linking approval, rejection, unlink, and recovery tests if linking is enabled later.
- SCIM create, update, patch, deactivate, repeated event, and invalid auth tests if SCIM is enabled.
- Directory-sync preview/apply tests with confirmation, redacted output, and no implicit destructive group deletion.
- Group mapping drift tests.
- Deprovisioning tests covering sessions, API keys, service keys, support approvals, connector ownership, and workspace access.
- Access review redaction tests.
- `pnpm smoke:auth-providers:acceptance-contract` evidence generation and redaction checks.

### Validation

- A disabled external or local user cannot authenticate, use old sessions, or use old keys.
- Account linking cannot attach an identity from a different issuer without explicit policy.
- Provider settings, provider tests, audits, support bundles, and acceptance evidence contain no tokens, secrets, raw secret refs, raw provider responses, issuer paths, LDAP DNs, SAML assertions, provider account IDs, raw connector credentials, or session material.
- Local fallback remains available in single-org Docker Compose unless explicitly disabled with a validated alternate admin path.
- Multi-org deployments enforce org overrides and global defaults according to `TENANCY_MODE`.
- Access review exports contain no tokens, secrets, raw connector credentials, or session material.
- Support access expires without manual cleanup.

## Track Sequencing

Phase 21 depends on Phase 19 for the durable database contract. Phase 22 can run in parallel after the baseline migration command stabilizes. Phase 23 can continue from the implemented OIDC/GitHub/LDAP/SAML/SCIM foundation with live IdP evidence, enterprise group lifecycle validation, and any future destructive sync policy only after a real deployment requirement.
