# Execution Backlog: Scale And GA

This file covers Phase 32 through Phase 35. These tickets prove Romeo is not only feature-complete, but operable, supportable, and measurable at the selected deployment tier.

## HAM-P32-01: Evaluation And Analytics Foundation

Phase: 32 Analytics, Quality, And Retrieval Tuning.

Depends on: durable eval/retrieval schema and representative product workflows.

Goal: give admins and builders trustworthy visibility into quality, usage, provider reliability, and tool behavior.

Current status: partially implemented. Agent eval suites, cases, runs, scoring, model comparisons, human ratings, agent eval dashboards, and publish-time eval gates already persist through the durable eval schema and are covered by OpenAPI/SDK surfaces. `GET /api/v1/agents/{agentId}/eval-release-candidate-evidence` and `client.evals.releaseCandidateEvidence(agentId)` now provide metadata-only release-candidate evidence with publish-gate status, per-suite latest-run posture, case/result counts, requirement counts, human-rating counts, aggregate expected-tool-call and expected-tool-outcome pass/fail counts, failed tool-expectation case counts, and explicit redaction flags without returning eval inputs, eval outputs, rubric terms, reviewer comments, raw tool names, raw tool arguments, raw output keys, raw error codes, or raw tool result bodies. The backend also exposes `GET /api/v1/admin/analytics/summary`, `GET /api/v1/admin/analytics/summary.csv`, `client.admin.analyticsSummary()`, and `client.admin.analyticsSummaryCsv()` as a metadata-only admin analytics layer across eval outcomes, release-gate status, usage totals/provider cost rollups, provider operational posture, tool-call status counts, and background-job alert posture. The summary and CSV omit eval prompts, eval outputs, human comments, usage metadata payloads, job payloads, tool inputs, provider URLs, credential refs, and secret refs. `pnpm smoke:quality:target` now captures target API evidence across analytics JSON/CSV, one or more release-candidate eval reports, representative retrieval replay/replay-compare readback, and optional pgvector-to-Qdrant route comparison while retaining only aggregate status, counts, route-mode metadata, eval subject hashes, redaction flags, and CSV hashes; `pnpm smoke:quality:contract` proves analytics, eval, replay, raw eval subject ID rejection, required vector-comparison, and required eval-gate failure behavior locally. `pnpm smoke:analytics:authz-contract` now proves local admin analytics JSON/CSV authorization, dual-scope enforcement, eval evidence scope/grant enforcement, and raw-content/token redaction for the analytics/eval evidence surfaces. `pnpm evidence:analytics-authz-live`, `ANALYTICS_AUTHZ_EVIDENCE_PATH`, `GET /api/v1/admin/analytics/authz-posture`, and `client.admin.analyticsAuthzPosture()` now provide metadata-only target authorization readback for admin analytics summary/CSV readback, usage-scope denial, eval resource-grant enforcement, non-admin denial, cross-org denial, cross-workspace scoping, CSV hash capture, and redaction review. `pnpm ga:checklist` now rejects dry-run, missing/stale target-quality `generatedAt`, raw eval subject IDs, missing eval-gate, missing replay, missing vector-comparison proof when `--require-target-quality-vector-comparison` is used, or missing redaction target-quality evidence. Target analytics authorization/export evidence can now be promoted to a strict optional Phase 32 GA gate with `pnpm ga:checklist -- --require-analytics-authz-live` / `GA_REQUIRE_ANALYTICS_AUTHZ_LIVE=true`, and `pnpm ga:target-preflight` maps it to `ANALYTICS_AUTHZ_EVIDENCE_REVIEWED=true pnpm evidence:analytics-authz-live -- --output dist/ci/analytics-authz-live-evidence.json` before reporting readiness. Remaining work is executing target-deployment quality capture, mounting reviewed analytics authorization/export evidence from the selected deployment, representative retrieval corpus selection/tuning, and any UI presentation work.

Scope details:

- Eval suites, cases, scoring results, model/provider configuration, run metadata, dashboards, exports, and release quality gates.

Tasks:

- Define eval data model and retention.
- Add dashboards for eval outcomes, usage, provider reliability, and tool behavior.
- Add release gates for required suites.
- Add role-scoped exports with redaction.
- Store enough metadata for reproducibility without exposing hidden payloads.

Definition of done:

- Admins can inspect eval outcomes and provider/tool reliability.
- Quality gates can block promotion.
- Exports are role-scoped and safe by default.
- Target-deployment quality evidence can be collected without copying raw eval, analytics, or replay content.

Testing:

- Eval data model and scoring tests.
- Dashboard authorization tests.
- Export redaction tests.
- Quality gate pass/fail tests.
- Target quality evidence contract smoke for analytics, eval, replay, raw eval subject ID rejection, required eval-gate failures, and GA validator rejection of missing replay/redaction.
- Analytics authorization/export contract smoke for admin-scope, usage-scope, agent-scope, resource-grant, CSV hash, token redaction, and raw-content redaction behavior.
- Target analytics authorization posture tests for mounted live evidence, target deployment mode, non-admin/cross-org denial, cross-workspace scoping, CSV hash evidence, and raw-content redaction.

Validation and evidence:

- Eval suite evidence for a release candidate.
- Analytics authorization report.
- Export redaction scan.
- `romeo.analytics-authz-contract-smoke.v1` local contract evidence.
- Live `romeo.analytics-authz-live-evidence.v1` mounted through `ANALYTICS_AUTHZ_EVIDENCE_PATH` with sanitized readback through `/api/v1/admin/analytics/authz-posture`.
- Optional strict Phase 32 GA evidence through `pnpm ga:checklist -- --require-analytics-authz-live` plus `ANALYTICS_AUTHZ_EVIDENCE_REVIEWED=true` target preflight.
- Live `romeo.target-quality-evidence.v1` target evidence with passing eval-gate and representative retrieval replay readback when a deployment is available.

Compose and Kubernetes impact:

- Analytics must run on the same Postgres contract in Compose and Kubernetes.

Security and migration notes:

- Raw eval inputs are governed workspace content, not general operational metadata.

## HAM-P32-02: Retrieval Tuning And Corpus Replay

Phase: 32 Analytics, Quality, And Retrieval Tuning.

Depends on: representative corpora and stable retrieval APIs.

Goal: tune retrieval with evidence instead of assumptions.

Current status: partially implemented. `POST /api/v1/admin/rag/replay` and `client.knowledge.replayTiered(...)` now provide a bounded metadata-only replay API over the existing tiered retrieval path. Replay cases accept knowledge-base IDs, query text, optional expected chunk IDs, and tier budgets; reports return aggregate and case-level hit counts, matched expected count, precision, recall, latency, route-mode counts, fallback-reason counts, and redaction posture without echoing queries, expected chunk IDs, hit IDs, chunk text, source content, vector values, vector endpoints, or secret refs. `POST /api/v1/admin/rag/replay/compare` and `client.knowledge.compareTieredReplay(...)` now provide sanitized baseline/candidate replay comparison reports with metric deltas and an overall outcome for retrieval-default change evidence, without storing raw query/corpus/hit/vector material. Target-quality evidence can now require the replay-compare artifact to prove pgvector baseline and Qdrant/external-vector candidate route coverage through sanitized route-mode counts, and GA/preflight expose that strict requirement through `--require-target-quality-vector-comparison` plus `TARGET_QUALITY_REQUIRE_VECTOR_COMPARISON=true`. Governed retrieval-default changes now have `GET /api/v1/admin/rag/policy/change-request`, `POST /api/v1/admin/rag/policy/change-requests`, approve/reject endpoints, and `client.admin.*RagPolicyChangeRequest(...)` helpers. The workflow records current/proposed policy metadata, changed fields, optional justification code, bounded replay-evidence summary, review state, stale-policy protection, and metadata-only audits without adding migrations. Remaining work is representative corpus selection and executed target-corpus before/after evidence, including running the pgvector/Qdrant comparison path against the selected deployment where Qdrant is enabled.

Scope details:

- Rank-fusion weights, pgvector and optional Qdrant comparison, citation precision/recall, latency, no-answer behavior, and corpus replay.

Tasks:

- Build replay harness for representative corpora.
- Track before/after metrics for retrieval changes.
- Compare pgvector and Qdrant where Qdrant is enabled.
- Require approval for default weighting changes.
- Document corpus limits and retention.

Definition of done:

- Retrieval changes have replay evidence.
- Defaults are not changed without corpus metrics.
- Users without workspace access cannot view corpus artifacts.

Testing:

- Retrieval replay tests.
- Authorization tests for eval/retrieval artifacts.
- pgvector versus Qdrant tests where enabled.

Validation and evidence:

- Retrieval before/after report.
- Query latency and citation metric report.

Compose and Kubernetes impact:

- Compose should support replay on small corpora; Kubernetes should support representative volume testing.

Security and migration notes:

- Corpus artifacts inherit workspace access and deletion policy.

## HAM-P32-03: Enterprise RAG Isolation And Tiered Retrieval

Phase: 32 Analytics, Quality, And Retrieval Tuning.

Depends on: durable knowledge-base APIs, resource grants, pgvector embedding repository, provider embedding adapters, and tenant-isolation negative suite foundations.

Goal: support secure retrieval across user, team/workspace, org, and approved shared RAG scopes while preserving Docker Compose simplicity and enabling Kubernetes enterprise isolation modes.

Current status: partially implemented. Knowledge bases, sources, chunks, and embeddings carry `orgId`, `workspaceId`, `knowledgeBaseId`, and source/chunk ownership metadata; knowledge-base reads require workspace access plus resource grants; persisted pgvector retrieval is bounded to explicit org, workspace, knowledge-base, provider, model, and dimension predicates before similarity ranking, then post-filters visible chunks. The greenfield baseline now physically hash-partitions `knowledge_chunk_embeddings` by `org_id` with 16 partitions plus partition-safe embedding primary/unique constraints, so pgvector queries are partition-prunable without adding follow-on migrations. `POST /api/v1/knowledge-bases/query` now compiles an authorization-filtered retrieval plan before vector or lexical lookup, supports user-private, workspace, policy-assigned org-published, and policy-assigned shared tiers, including non-admin cross-org shared libraries when the subject org assigns the KB to `shared` and the resource-owning org grants `use`, applies per-tier result budgets, returns per-hit citation/provenance/tier metadata, reports sanitized pgvector shared-row-scope posture plus deployment-managed external vector-store driver/config/routing booleans, namespace policy, and per-entry/hit `retrievalRoute` metadata for pgvector, Qdrant/external-vector, lexical fallback, provider/model/dimension, and fallback reason, partially succeeds with skipped reason counts for mixed authorization, fails closed when no submitted base is authorized or policy disables every authorized tier, and audits metadata-only retrieval-plan summaries without query text or chunk text. `GET/PATCH /api/v1/admin/rag/policy` persists org RAG policy in `system_settings`, enforces enabled tiers plus default/max result budgets for implemented tiers, stores org/shared KB tier assignments, enforces allowed embedding provider/model pairs before provider-backed indexing, before Qdrant upsert, and during query-time persisted-vector selection before external vector search, stores data-residency tags, and now exposes deployment-managed external-vector namespace/partitioning policy, physical vector isolation mode/enforcement policy, Postgres-authoritative DR/reindex strategy, metadata-only export policy, and restore-validation posture without a migration. The RAG policy approval workflow stores one org-scoped change request in `system_settings`, supports pending readback, create, approve/apply, and reject decisions, blocks stale approvals if the current policy differs from the request baseline, and keeps audits metadata-only. Source deletion clears source embeddings and chunks, deletes stored source objects, and records metadata-only retention evidence without object keys, filenames, chunk text, embedding vectors, or source content; when Qdrant routing is active, deletion sends an external source-vector delete request before local cleanup. Source reindex commits replacement source/chunk state before tombstoning scoped external source vectors, and skips the tombstone if the authoritative transaction fails. `GET /api/v1/admin/rag/posture` exposes aggregate-only pgvector/shared-row-scope posture, active retrieval driver (`pgvector` or `qdrant`), `authoritativeStore: "postgres"`, sanitized disabled/Qdrant deployment wiring and routing-active posture, Qdrant live evidence status/policy/query/delete booleans when mounted through `QDRANT_LIVE_EVIDENCE_PATH`, physical isolation policy/deployment status, pgvector physical-isolation evidence status/counts, source/chunk/embedding coverage, stale counts, knowledge job counts, fallback reason codes, and readiness warnings without raw corpus, vector, secret, endpoint, collection, namespace, evidence path, SQL, database URL, API key, point ID, payload value, or job payload values. `VECTOR_ISOLATION_MODE` now declares deployment isolation mode for Compose/Helm and posture checks; required physical-isolation policy warns on deployment mismatch or pending live evidence while keeping Postgres authoritative, and external-vector policies become satisfied only when live Qdrant evidence passes and matches the configured namespace/partitioning policy. `GET /api/v1/admin/readiness` fails incomplete Qdrant deployment wiring, unsafe Qdrant URLs, disabled secret resolution for external secret refs, unavailable Qdrant collections, or `pgvector_partitioned_by_org` mode without passed live `romeo.pgvector-physical-isolation-review.v1` evidence from `pnpm review:pgvector-isolation`, and passes Qdrant routing only after a bounded metadata-only collection health check succeeds. The Qdrant adapter mirrors provider embeddings with scoped payloads that include deployment namespace and optional partition tokens, queries/deletes with those tokens plus org/workspace/knowledge/source/provider/model/dimension filters, and falls back to pgvector if external query fails. `pnpm smoke:qdrant:live` now writes `romeo.qdrant-live-evidence.v1` target evidence by proving live collection health, synthetic point upsert, scoped namespace/partition query behavior, namespace/partition/foreign-org trap exclusion, vector omission, scoped delete/readback, cleanup, and redaction without storing raw endpoints, collection names, API keys, namespace values, partition values, payload values, point IDs, or vectors. `pnpm smoke:qdrant:dr` now writes `romeo.qdrant-dr-consistency.v1` evidence with source preparation, restored-collection scoped readback, foreign-org trap exclusion, vector omission, restored all-smoke-point cleanup, source all-smoke-point cleanup, and redaction without storing raw endpoints, collection names, API keys, run secrets, source evidence bodies/paths, namespace values, payload values, point IDs, or vectors. The tenant-isolation negative suite now includes external-vector post-filtering evidence that injects a high-score guessed cross-tenant Qdrant hit and proves only authorized Postgres chunks are returned, plus Qdrant allowlist-denial evidence proving disallowed provider/model pairs do not call providers, enqueue embedding jobs, upsert to Qdrant, or search Qdrant after policy rotation. Repository conformance now also proves same-KB, wrong-workspace pgvector embeddings are excluded by the repository search predicate. `pnpm smoke:compose:tiered-rag` now adds live local Compose evidence for one org, multiple workspaces, user-private/workspace/org/shared corpora, service-account-owned corpora, denied-corpus skip behavior, metadata-only audit readback, tenancy-mode bootstrap readback, and generated-secret/raw-corpus log redaction. Executed live Qdrant target evidence, Kubernetes tiered-RAG smoke evidence, target Qdrant DR consistency evidence, broader live vector-tenant negative tests, and broader target-corpus search-quality evidence remain backlog.

Scope details:

- Kubernetes tiered-RAG target evidence now has a guarded live harness through `pnpm smoke:kubernetes:tiered-rag`; execution against a reachable selected namespace is still required before this item is closed.
- Qdrant restored-stack consistency now has `pnpm smoke:qdrant:dr`; execution against the selected restored Qdrant target is still required before external-vector DR can be called closed.
- Tiered retrieval plan across user-private, team/workspace, org-published, admin-approved shared, and explicitly allowed cross-org corpora.
- Isolation modes: shared pgvector row scope, pgvector partitions by org/tier, dedicated schema/database per regulated org, external vector namespace or collection per org, and dedicated cluster/account/project for high-side deployments, with deployment mode now declared through `VECTOR_ISOLATION_MODE` and policy/report posture exposed through the RAG admin APIs.
- Implemented baseline sanitized admin RAG posture API plus mounted live external-vector evidence summary, namespace/partition proof, live index health booleans, and readiness warnings.
- Optional Qdrant runtime support as the first external vector-store target, with Postgres chunk ids remaining authoritative.

Tasks:

- Keep the implemented retrieval-route response/audit metadata current as provider-vector and external-vector routing expands.
- Extend the implemented org-level RAG policy with live provider-routing evidence for any deployment-specific routing policy beyond the current provider/model allowlist enforcement and the current external-vector DR/export policy surface.
- Maintain the implemented sanitized admin RAG posture/readiness APIs with live evidence for external-vector and physical partitioned modes; do not expose database URLs, vector-store endpoints, raw evidence paths, raw namespace names when sensitive, secret refs, SQL, query text, chunk text, or embedding vectors.
- Maintain the implemented Qdrant adapter plus live and DR consistency evidence harnesses with namespace/collection evidence and target-deployment degraded-mode runbooks.
- Use `pnpm review:pgvector-isolation` and target query-plan evidence before claiming `pgvector_partitioned_by_org` in a live deployment, even though the greenfield baseline already creates the partitioned table.
- Continue to omit query text and chunk content from retrieval-plan audits by default.
- Prove restored Postgres/object/vector consistency and live delete/export/readback behavior for each enabled external-vector backend.

Definition of done:

- A user query can retrieve from every authorized tier and no unauthorized tier.
- Every vector lookup includes scope filters before similarity ranking and post-query authorization checks after chunk-id readback.
- Compose remains a single-org pgvector path by default.
- Kubernetes can run shared, partitioned, and external-vector modes through explicit configuration and readiness.
- Admins can see sanitized RAG/vector posture and degraded states without seeing secrets or raw content.
- Deletion and restore evidence covers Postgres chunks, object-store source content, pgvector rows, and external vector records where enabled.

Testing:

- Unit tests for retrieval-plan compilation, tier priority, max-result budgeting, citation provenance, same-org org/shared tier assignment policy, non-admin cross-org shared-library authorization, and external-vector policy.
- API authorization tests for user/team/workspace/org/shared tiers, including cross-org shared libraries requiring both policy assignment and owning-org `use` grants.
- Tenant-isolation negative tests for guessed knowledge-base, source, chunk, embedding, and external-vector ids; the local suite already covers stale/cross-tenant Qdrant hit post-filtering and Qdrant allowlist-denial behavior.
- Query-plan and evidence tests for pgvector filters, partition predicates, and `pnpm review:pgvector-isolation` metadata.
- External vector-store contract tests for namespace isolation, stale chunk ids, delete/tombstone behavior, allowlist-denial behavior, and fallback.
- Redaction tests for posture APIs, audits, jobs, logs, and support bundles.

Validation and evidence:

- `pnpm smoke:compose:tiered-rag` evidence for one org, multiple teams/workspaces, user-private/workspace/org/shared corpora, denied corpus skip behavior, metadata-only audit readback, and log redaction.
- `pnpm review:pgvector-isolation` live evidence mounted through `PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH` before any deployment claims `VECTOR_ISOLATION_MODE=pgvector_partitioned_by_org`.
- `pnpm smoke:qdrant:live` live evidence mounted through `QDRANT_LIVE_EVIDENCE_PATH` before any deployment claims external-vector physical isolation through Qdrant; use `pnpm ga:checklist -- --require-qdrant-live` when the selected release claims live Qdrant isolation.
- `pnpm smoke:qdrant:dr` source/restore/cleanup evidence for restored-stack external-vector consistency before any deployment claims Qdrant DR coverage; use `pnpm ga:checklist -- --require-qdrant-dr` when Qdrant DR is enabled for the selected release.
- `pnpm smoke:kubernetes:tiered-rag` live evidence for the selected isolation mode: shared pgvector, partitioned pgvector, or external vector namespace.
- Representative retrieval replay report before tuning defaults.
- DR drill showing restored Postgres/object/vector state consistency.
- Tenant-isolation report proving cross-org vector queries fail closed.

Compose and Kubernetes impact:

- Compose defaults to one Postgres/pgvector database with row-scoped retrieval and no external vector dependency.
- Kubernetes values should support external vector-store secret references, NetworkPolicy egress to the vector store, optional per-org namespace mapping through managed config, and readiness warnings when the selected isolation mode is underconfigured.
- CloudNativePG and external hosted Postgres must keep the same app contract for pgvector readiness, schema validation, backup, restore, and DR evidence.

Security and migration notes:

- Do not expose or mutate vector-store credentials through user APIs.
- Treat vector ids, collection names, and namespace names as sensitive posture when they reveal tenant names.
- Prefer policy and adapter boundaries before schema changes; if partitions or mapping tables are needed after the baseline lock, use one forward migration with upgrade tests and rollback/mitigation notes.
- Do not store query text, chunk text, source documents, or embedding vectors in audit, job, usage, or support metadata unless a separate retention policy explicitly allows it.

## HAM-P33-01: Tenant Isolation Negative Suite

Phase: 33 SaaS And Multi-Tenant Hardening.

Depends on: identity lifecycle and durable repository coverage.

Goal: prove tenants cannot read, write, infer, or operate on each other's data.

Scope details:

- API routes, workers, repository methods, object-store artifacts, connector records, workflows, notifications, billing, support access, exports, and logs.

Tasks:

- Generate cross-tenant fixtures.
- Test guessed IDs across every API group.
- Test worker scoped API keys and service accounts.
- Test object-store artifact authorization.
- Review repository queries for missing org/workspace predicates.
- Add denial audit records where useful.

Definition of done:

- Cross-tenant negative tests cover all API and worker surfaces.
- Guessed IDs do not bypass authorization.
- Object artifacts are inaccessible across tenants.

Testing:

- Cross-tenant API negative suite.
- Worker credential negative tests.
- Object artifact authorization tests.
- Support access scope tests.

Validation and evidence:

- Tenant isolation report.
- Query predicate review checklist.

Compose and Kubernetes impact:

- Tests should run against local Postgres and in CI; hosted/SaaS Kubernetes uses the same suite.

Security and migration notes:

- Isolation fixes that require schema changes must include migration review.

## HAM-P33-02: Distributed Quotas, Abuse Controls, And Billing Ops

Phase: 33 SaaS And Multi-Tenant Hardening.

Depends on: Valkey-backed distributed coordination and billing foundation.

Goal: prevent runaway usage and reconcile billing/entitlements across multiple app instances.

Current status: partially implemented. Global tenant administration now exists through `GET|POST /api/v1/admin/organizations`, `GET|PATCH /api/v1/admin/organizations/{orgId}`, suspend/reactivate, deletion-request, deletion-request cancel, deletion-finalization preview, deletion-finalization evidence, deletion-finalization execute, and tenant purge evidence posture routes plus TypeScript SDK helpers. Provisioning creates an organization, default workspace, and optional initial local `org_admin` with Argon2id password storage; cross-org tenant administration requires `global_admin`; lifecycle posture, finalization-evidence posture, purge-result posture, and mounted target purge evidence posture expose counts/status/control hashes only. The finalization preview reports deletion request/suspension/evidence preconditions plus storage-class counts for Postgres records, tracked object-store artifacts, knowledge/vector rows, data-export packages, background jobs, audit logs, and external secret-store review; evidence recording stores reviewed status plus optional evidence-reference hashes for Postgres purge planning, object-store purge planning, external-vector purge, backup retention, operational-log retention, support-bundle retention, and external secret-store review without returning raw evidence refs, evidence bodies, object keys, logs, secrets, or vector values. Final execution requires exact org confirmation plus `confirmPermanentDeletion: true`, deletes app-tracked Postgres rows and tracked object-store objects after every control is satisfied, and returns sanitized record/object counts plus external-evidence booleans only. `pnpm evidence:tenant-purge`, `TENANT_PURGE_EVIDENCE_PATH`, `GET /api/v1/admin/tenant-deletion/purge-evidence-posture`, and `client.admin.tenantPurgeEvidencePosture()` provide metadata-only readback for reviewed target tenant purge evidence without returning mounted paths, evidence bodies, backup locations, operational logs, support bundle bodies, secret values, object-store keys, or vector values. Target tenant purge can now be promoted to an optional strict Phase 33 GA gate with `pnpm ga:checklist -- --require-tenant-purge-live` or `GA_REQUIRE_TENANT_PURGE_LIVE=true`; `pnpm ga:target-preflight` requires `TENANT_PURGE_EVIDENCE_REVIEWED=true` and reports sanitized review posture only. `GET/PATCH /api/v1/admin/abuse-controls`, TypeScript SDK `client.admin.abuseControls()` / `client.admin.updateAbuseControls(...)`, and generated Python SDK `get_admin_abuse_controls` / `patch_admin_abuse_controls` expose the org-scoped abuse-control policy without adding a migration. The policy supports org suspension, billing-status entitlement enforcement, missing-plan denial, and kill switches for provider IDs, connector IDs, tool IDs, and worker classes. Enforcement now blocks cost-incurring model runs, built-in and imported tool execution, external tool dispatch enqueue/claim, connector sync, knowledge ingestion/reindex/embedding jobs, browser automation worker enqueue/claim, and file uploads before persistent side effects where the service has enough context. Blocked attempts write metadata-only `abuse_control.enforcement_blocked` audit rows with action, reason codes, and resource identifiers but no raw prompts, tool payloads, connector bodies, object keys, worker payloads, or provider payloads. External vector stores, backups, operational logs, support bundles, and external secret stores remain governed deployment-evidence controls. File uploads now consume the existing `storage.byte` quota metric. Optional distributed quota coordination now exists behind `QUOTA_COORDINATION_DRIVER=valkey`; quota consumption atomically reserves every matching bucket in Valkey before Postgres usage writes, fails closed with `503 quota_coordination_unavailable` when Valkey is configured but unavailable, catches Postgres usage up to higher distributed counters, syncs admin quota create/update/delete changes into the coordinator, and exposes sanitized posture at `GET /api/v1/quotas/distributed-status` plus TypeScript SDK `client.admin.quotaCoordinationStatus()`. Compose and Helm expose the driver, key prefix, timeout, and `VALKEY_URL` without adding schema or migration files. `GET /api/v1/admin/edge-security/posture` and `client.admin.edgeSecurityPosture()` now expose sanitized TLS/proxy/WAF/HSTS/security-header/request-body-limit/HTTP-rate-limit posture with warning checks, while the API emits defensive response headers, rejects oversized request bodies from deployment config, and enforces app-level public/auth/webhook/authenticated request-rate limits with sanitized 429 responses; Compose and Helm expose the edge posture env without storing raw origins, ingress annotations, proxy IP ranges, raw client identifiers, or secrets. `pnpm smoke:edge:live` now provides the live target edge/WAF/API-gateway enforcement collector for defensive headers, admin posture redaction, WAF block proof, oversized request rejection, and public rate-limit proof; `pnpm smoke:edge:contract` proves the collector rejects missing header, WAF, body-limit, and rate-limit controls without retaining bearer tokens or raw probes. `pnpm smoke:compose:distributed-controls` now adds local live multi-app-instance evidence: it runs two Compose app replicas, proves Valkey-backed authenticated HTTP rate-limit counters are shared across replicas, proves Valkey-backed quota coordination is healthy, consumes quota through both replicas, stops Valkey, and requires a sanitized fail-closed `quota_coordination_unavailable` response. Billing entitlement readback now exists at `GET /api/v1/billing/entitlements`, TypeScript SDK `client.admin.billingEntitlements()`, and `romeo billing entitlements`; reconciliation now exists at `POST /api/v1/billing/entitlements/reconcile`, `client.admin.reconcileBillingEntitlements()`, and `romeo billing reconcile-entitlements`. The report compares billing plan quota templates to enforced org quota buckets, flags missing and mismatched quotas and non-entitled plan statuses, omits raw provider payloads, and reconciliation recreates/repairs org quotas without deleting extra manual buckets. Scheduled reconciliation now has a bounded worker through `romeo workers billing-entitlement-reconcile`, Compose `billing-entitlement-reconcile-worker`, and Helm `workers.billingEntitlementReconcile` CronJob wiring. Billing lifecycle posture/enforcement now exists through `GET /api/v1/billing/lifecycle`, `POST /api/v1/billing/lifecycle/enforce`, TypeScript SDK `client.admin.billingLifecycle()` / `client.admin.enforceBillingLifecycle()`, `romeo billing lifecycle`, `romeo billing enforce-lifecycle`, `romeo workers billing-lifecycle-enforce`, Compose `billing-lifecycle-enforce-worker`, and Helm `workers.billingLifecycleEnforce`. `pnpm smoke:compose:billing-scheduler` now proves local deployable billing worker cadence/readback/redaction by creating entitlement drift, running the Compose entitlement worker service until API readback is healthy, creating an expired trial lifecycle, running the Compose lifecycle worker service until status changes to `past_due`, and scanning worker/Compose logs for generated secrets and raw billing sentinels. Target billing operations evidence can now be recorded with `pnpm evidence:billing-operations`, mounted through `BILLING_OPERATIONS_EVIDENCE_PATH`, read through `GET /api/v1/admin/billing/operations-posture` / `client.admin.billingOperationsPosture()`, and promoted to an optional strict GA gate with `pnpm ga:checklist -- --require-billing-operations-live` or `GA_REQUIRE_BILLING_OPERATIONS_LIVE=true`. `pnpm ga:target-preflight` maps that gate to `BILLING_OPERATIONS_EVIDENCE_REVIEWED=true pnpm evidence:billing-operations -- --output dist/ci/billing-operations-evidence.json` and reports only metadata-only cadence, worker, API readback, alerting, warning, and redaction posture without returning raw billing payloads, worker logs, customer identifiers, alert payloads, evidence bodies, or secrets. Remaining work: execute live edge enforcement in the selected target deployment, execute and mount live scheduled billing alerting/cadence evidence from the selected target deployment, collect Kubernetes scale evidence, and execute plus mount reviewed target tenant purge evidence for app-owned purge, external vector, backup, operational-log, support-bundle, and external secret-store purge/retention controls.

Scope details:

- Current suspended-tenant enforcement additionally covers direct OpenAI-compatible chat and embedding requests, eval provider runs, voice provider requests, scheduled connector/workflow creation, browser automation artifact upload registration, explicit webhook test/retry egress, and explicit notification retry egress. Those paths reuse the same metadata-only `abuse_control.enforcement_blocked` audit posture and do not require a migration.

- Distributed request/run/upload/provider/tool/worker limits, entitlement enforcement, abuse kill switches, billing reconciliation, trial/subscription lifecycle, and support/admin exports.

Tasks:

- Keep Valkey-backed distributed quota reservations and HTTP request-rate limits proven across multiple app instances.
- Add kill switches by org, provider, connector, tool, and worker class.
- Keep scheduled entitlement reconciliation jobs proven in Compose and prove cadence, API-key scope, log redaction, alerting, and failure recovery in target deployments.
- Keep quota coordination, quota bucket, and billing status visibility API/SDK coverage current.
- Maintain app-level request body/file/rate limits plus WAF/ingress posture documentation, and prove live WAF/API-gateway enforcement for public SaaS.

Definition of done:

- Rate limits and quotas work across multiple app instances with fail-closed coordination when configured.
- Suspended tenants cannot create new cost-incurring work.
- Billing entitlements are enforced and reconcilable through API and scheduled operations evidence.
- Live target edge evidence proves security headers, WAF/API-gateway block behavior, oversized request rejection, public rate-limit enforcement, and redaction.

Testing:

- Multi-instance rate-limit and quota-coordination smoke evidence.
- Quota and entitlement tests.
- Billing webhook idempotency, entitlement report, and reconciliation tests.
- Tenant suspension/reactivation tests.
- Edge enforcement contract smoke for missing header, WAF, body-limit, and rate-limit failures.

Validation and evidence:

- Distributed quota/rate-limit report including Valkey health, shared HTTP counters, and fail-closed behavior.
- Billing reconciliation report and Compose billing scheduler evidence.
- Suspension negative test evidence.
- Live `romeo.live-edge-enforcement.v1` evidence from the selected ingress/WAF/API-gateway.

Compose and Kubernetes impact:

- Compose can run a small multi-app-instance smoke where practical; Kubernetes is the target for scale validation.

Security and migration notes:

- Abuse controls and kill switches must be audited without storing raw payloads.

## HAM-P33-03: Data Rights, Privacy, And Support Bundles

Phase: 33 SaaS And Multi-Tenant Hardening.

Depends on: governance deletion/export foundation and support policy.

Goal: make export, deletion, residency, backup limitations, and support evidence explicit and testable.

Current status: partially implemented. `pnpm support:bundle` now creates metadata-only `romeo.support-bundle.v1` support bundles with runtime/package posture, allowlisted configuration posture, deployment hashes, migration inventory, evidence schema/status/hash summaries, access-review evidence links, data-rights API/evidence pointers, data-rights retention evidence mount posture, and optional log metadata without raw log lines, report bodies, object keys, vector values, backup locations, or secret values. `pnpm smoke:support-bundle-redaction` injects raw sentinels through environment variables, logs, evidence files, and a synthetic access-review report, then writes `romeo.support-bundle-redaction.v1` evidence proving those values stay out of the bundle while the access-review evidence remains linkable by metadata. `GET /api/v1/admin/support-bundle/posture`, `client.admin.supportBundlePosture()`, and `SUPPORT_BUNDLE_PATH` / `SUPPORT_BUNDLE_REDACTION_EVIDENCE_PATH` deployment wiring now expose mounted support-bundle and redaction evidence as generation, count, required-check, warning, and redaction posture only, without returning mounted paths, evidence file paths, evidence bodies, log bodies, raw environment values, prompts, provider payloads, connector payloads, backup locations, object-store keys, vector values, tokens, or secrets. `GET /api/v1/governance/data-rights/coverage`, `client.governance.dataRightsCoverage(...)`, and the generated Python SDK `data_rights_coverage()` method now expose metadata-only deletion/export workflow posture, supported deletion resource types, storage-class coverage, backup-retention limits, support-bundle redaction posture, optional deployment-specific operational-log and backup retention evidence status, and remaining gaps without returning customer content, object keys, vector IDs, vector values, secret refs, logs, backup locations, evidence file paths, prompts, provider payloads, connector payloads, or document bodies. `pnpm evidence:data-rights-retention` creates reviewed `romeo.data-rights-retention-evidence.v1` files for `operational_logs` or `backups`, and Compose/Helm expose `DATA_RIGHTS_OPERATIONAL_LOG_RETENTION_EVIDENCE_PATH` plus `DATA_RIGHTS_BACKUP_RETENTION_EVIDENCE_PATH` so the API can report status, retention days, destruction-validation/encryption booleans, reviewed-system counts, and failure codes only. `POST /api/v1/governance/data-exports/preview`, `POST /api/v1/governance/data-exports/execute`, `client.governance.previewDataExport(...)`, `client.governance.executeDataExport(...)`, and generated Python SDK `preview_data_export()` / `execute_data_export()` provide an admin-read governed JSON export for the current org or one workspace. `GET /api/v1/governance/data-exports/packages`, `POST /api/v1/governance/data-exports/packages`, `GET /api/v1/governance/data-exports/packages/{packageId}/content`, `DELETE /api/v1/governance/data-exports/packages/{packageId}`, TypeScript SDK package lifecycle helpers, and generated Python SDK package lifecycle helpers now store, list, download, and delete governed JSON export packages through object storage plus a bounded `system_settings` metadata registry while returning only server download URL where relevant, size, SHA-256, object-key hash, confirmation status, and redaction booleans. The existing retention enforcement API and worker path now remove expired package artifacts and registry entries with aggregate deleted/missing counts only. Content and object bytes require explicit flags; object bytes are bounded per object and across the export; exports include metadata-only RAG/vector policy posture and background job ledgers, with org exports including all jobs and workspace exports including first-class workspace-keyed jobs only; object-store keys, embedding vectors, vector IDs, vector endpoints, collection names, namespaces, connector secret refs, raw connector configs, worker payload values, background-job artifact storage keys, operational logs, and backup locations remain excluded. Separate large binary archive formats, target external-vector restore/delete proof execution, target deployment generation/mounting of operational-log and backup retention evidence, target review/mount of support evidence, and storage-class expansion for future persistent surfaces remain open only where deployment requirements demand them.

The operational-log and backup retention/destruction proof can now be promoted from mounted target posture to a strict optional GA gate with `pnpm ga:checklist -- --require-data-rights-retention-live` or `GA_REQUIRE_DATA_RIGHTS_RETENTION_LIVE=true`. `pnpm ga:target-preflight` maps that gate to the reviewed metadata-only evidence generation commands and requires operator-reviewed retention-day inputs before it reports ready; this does not replace the need to run the target controls in the selected deployment.

Target billing worker cadence, entitlement/lifecycle API readback, worker-log redaction, and alerting proof can now be promoted from mounted posture to a strict optional GA gate with `pnpm ga:checklist -- --require-billing-operations-live` or `GA_REQUIRE_BILLING_OPERATIONS_LIVE=true`. `pnpm ga:target-preflight` maps that gate to the billing operations evidence command and requires `BILLING_OPERATIONS_EVIDENCE_REVIEWED=true` before it reports ready; this does not replace the need to run the target billing CronJobs and alert drills in the selected deployment.

Target support-bundle generation and review proof can now be promoted from mounted posture to a strict optional Phase 35 GA gate with `pnpm ga:checklist -- --require-support-bundle-live` or `GA_REQUIRE_SUPPORT_BUNDLE_LIVE=true`. `pnpm ga:target-preflight` maps that gate to `SUPPORT_BUNDLE_EVIDENCE_REVIEWED=true pnpm support:bundle -- --output dist/ci/support-bundle.json` and requires reviewed-evidence confirmation before it reports ready; this does not replace the need to generate the bundle from selected target evidence, review support-bundle redaction evidence, and mount the metadata-only files in the selected deployment.

Scope details:

- Data export, deletion request workflows, storage-class coverage, backup retention limits, data residency notes, and sanitized support bundles.
- Deployment-generated operational-log and backup retention evidence mounted through backend posture APIs.

Tasks:

- Classify data by storage class and retention policy.
- Keep the metadata-only data-rights coverage API current for database, object storage, vector/search indexes, logs, and backups.
- Generate and mount `romeo.data-rights-retention-evidence.v1` files per target deployment before claiming operational-log or backup retention controls are satisfied.
- Keep governed customer-content export and object-store package workflow evidence current; add separate large binary archive formats only after deployment requirements justify them.
- Add sanitized support bundle command.
  Keep `pnpm smoke:support-bundle-redaction` green in CI.
- Document backup retention limitations and residency assumptions.

Definition of done:

- Data deletion/export workflows are documented and tested.
- Support bundles are useful and redacted.
- Backup retention limitations are explicit.

Testing:

- Data deletion and export tests.
- Support bundle redaction tests.
- Backup retention documentation review.

Validation and evidence:

- Data deletion evidence.
- Export evidence.
- Support bundle redaction report.

Compose and Kubernetes impact:

- Support bundle works in Compose and Kubernetes with environment-specific collectors.

Security and migration notes:

- Support bundles must exclude secrets, prompts, document bodies, tokens, raw provider payloads, and raw connector payloads.

## HAM-P34-01: Scale Targets And Load Fixtures

Phase: 34 Scale, Performance, And Resilience.

Depends on: durable Postgres and representative workflows.

Goal: define measurable scale tiers and generate representative load safely.

Current status: partially implemented. `docs/deployment-sizing.md` defines initial tier targets and connection-budget math. `pnpm fixtures:scale` now generates deterministic synthetic fixtures with credential-pattern validation and report output, including local-import connector sync fixtures and imported OpenAPI tool dispatch-request fixtures. `pnpm smoke:scale:load` now validates load-driver coverage in CI dry-run mode and can run against a live Romeo API with `--base-url` plus `--api-key` for bounded latency evidence across core app writes/reads, local-import connector create/sync/readback, and imported OpenAPI tool import/enable/network-policy/operation-enable/preview/dispatch-request enqueue/cancel. `pnpm smoke:compose:scale` now provides live local Compose scale-smoke evidence with secure-mode startup, `TOOL_OPERATION_EXECUTION_DRIVER=http-fetch` dispatch-request readiness, real API writes/reads, latency summary, and generated-secret/raw-fixture log scanning. `pnpm smoke:kubernetes:load-soak` now wraps the live scale-load driver for selected-tier Kubernetes evidence with repeated small/enterprise fixture runs, namespace and Deployment readback, metadata-only per-run summaries, sanitized Deployment/Pod/HPA inventory without raw pod image IDs, soak duration checks, and pod-log redaction. `pnpm smoke:alerts:live` now collects live Prometheus and optional Alertmanager readback for required provider, queue-lag, dead-letter, and backup alert evidence, the monitoring rules include a kube-state-metrics-backed Postgres backup failure alert, and `pnpm smoke:alerts:contract` proves the live alert script's Prometheus/Alertmanager readback and failure behavior against loopback fixtures. Executed Kubernetes enterprise-tier load/soak results, live alert drills, and full external worker network execution remain open.

Scope details:

- Small self-hosted, enterprise self-hosted, and hosted SaaS tiers.
- Concurrent users, chats, runs, workflow resumes, connector syncs, uploads, notifications, webhooks, tool dispatches, browser tasks, eval runs, latency, error rate, cost, queue lag, artifact sizes, and retention.

Tasks:

- Keep target tier definitions current in `docs/deployment-sizing.md`.
- Build synthetic fixture generators.
- Build load drivers for chat, retrieval, upload, workflow resume, connector sync, tool dispatch, notification retry, and admin listing.
- Keep fixtures synthetic and secret-free.
- Promote dry-run load-smoke evidence to live small-tier Compose evidence, then Kubernetes enterprise-tier evidence.

Definition of done:

- Scale targets are concrete and tied to evidence.
- Load fixtures cover key user and worker paths.
- Fixture data contains no real customer data or secrets.

Testing:

- Fixture generation tests.
- Load driver smoke tests.
- Data classification checks for fixture output.
- CI dry-run evidence for fixture safety and driver inventory.

Validation and evidence:

- Target tier document.
- Load fixture report.
- Baseline load smoke results.
- Live load/soak report for the selected deployment tier before GA.
- Local Compose scale-smoke evidence for small development-tier regression coverage.

Compose and Kubernetes impact:

- Compose can run small-tier smoke; Kubernetes is required for enterprise and hosted tier evidence.

Security and migration notes:

- Load fixtures must not bypass normal authorization or retention paths.

## HAM-P34-02: Query Plan, Index, And Storage Review

Phase: 34 Scale, Performance, And Resilience.

Depends on: representative load fixtures and baseline schema lock.

Goal: verify high-volume database paths perform predictably before scale launch.

Current status: partially implemented. `pnpm review:postgres-query-plans` now captures sanitized `EXPLAIN FORMAT JSON` evidence for 21 high-volume Postgres paths across chat/run history, audit, usage, worker queues, connector sync, workflow resume, notification/webhook retry, retrieval including pgvector, access review, governed deletion, quota, and billing. The review fails when expected indexes are missing, records observed planner node/index use as advisory, omits raw SQL and row content from persisted evidence, is wired into the live pgvector CI job after migration/schema validation, and can mark target evidence with `--representative-volume --target-tier ... --postgres-mode ...`. `pnpm collect:postgres-telemetry` now collects metadata-only `romeo.postgres-slow-query-telemetry.v1` and `romeo.postgres-lock-telemetry.v1` evidence from target Postgres using aggregate `pg_stat_statements`, lock, and deadlock counters while omitting query text, parameter values, row data, lock statements, and secrets. `pnpm decide:postgres-archival` now writes metadata-only `romeo.postgres-archival-partitioning-decision.v1` evidence from target table size, estimated row, dead-tuple, sequential-scan, and vacuum posture, requires explicit `--accept-decision` for accepted evidence, fails accepted `no_runtime_partitioning_enabled` decisions that conflict with configured thresholds, and does not generate migrations. `GET /api/v1/admin/postgres/operational-posture` and `client.admin.postgresOperationalPosture()` now expose metadata-only repository driver, database URL configured boolean, `POSTGRES_POOL_MAX`, connection-budget guidance, query-plan coverage counts, and explicit warning codes for representative-volume query-plan evidence, slow-query telemetry, lock telemetry, and archival/partitioning decisions. Operators can mount reviewed evidence through `POSTGRES_QUERY_PLAN_EVIDENCE_PATH`, `POSTGRES_SLOW_QUERY_TELEMETRY_EVIDENCE_PATH`, `POSTGRES_LOCK_TELEMETRY_EVIDENCE_PATH`, and `POSTGRES_ARCHIVAL_PARTITIONING_DECISION_PATH`; valid evidence clears only its matching warning. The API redaction contract guarantees no configured evidence paths, evidence file bodies, database URLs, raw SQL, query parameter values, row data, lock statements, telemetry sample SQL, or secret values are returned. `pnpm ga:checklist -- --require-postgres-operations-live` / `GA_REQUIRE_POSTGRES_OPERATIONS_LIVE=true` now makes representative query-plan review, passed slow-query telemetry, passed lock telemetry, and accepted archival/partitioning evidence a strict Phase 34 GA gate; `pnpm ga:target-preflight` validates the operator prerequisites and requires `sslmode=verify-full` for external hosted Postgres without returning the URL or host. Target slow-query/lock telemetry, accepted archival/partitioning decisions, and representative-volume query-plan evidence still require execution and review in the selected environment before GA.

Scope details:

- Run history, audit listing, usage summary, job/worker queues, connector sync, workflow resume, notification retry, retrieval, access review, billing, and governed deletion.

Tasks:

- Keep `scripts/lib/postgres-query-plan-contract.mjs` aligned with high-volume repository and worker paths.
- Capture sanitized query plans after migration with `pnpm review:postgres-query-plans`.
- Re-run query-plan review under representative small, enterprise, and hosted/SaaS volumes with target labels.
- Collect slow-query and lock telemetry with `pnpm collect:postgres-telemetry` after representative traffic.
- Generate an explicit archival/partitioning decision with `pnpm decide:postgres-archival` after reviewing target table growth, retention, and restore windows.
- Keep the admin Postgres operational posture API and SDK aligned with the query-plan contract, connection-budget guidance, and remaining evidence gates.
- Mount reviewed Postgres evidence files through the explicit `POSTGRES_*_EVIDENCE_PATH` settings only after redaction review.
- Add forward-only indexes where representative plans prove need.
- Track slow queries and lock contention in target environments.
- Keep connection pool settings aligned with `POSTGRES_POOL_MAX` and deployment sizing guidance.
- Define archival or partitioning strategy for high-volume tables if needed.

Definition of done:

- High-volume query plans are reviewed.
- Required indexes are present.
- Admins can read sanitized Postgres operations posture through API and SDK without database URLs, SQL, row data, lock statements, or secrets.
- Connection pool guidance is published.
- Partitioning/archival decisions are documented.

Testing:

- Query-plan tests or recorded explain plans.
- Load tests for admin lists and worker queues.
- Backup/restore under loaded data volume.

Validation and evidence:

- Query-plan review report from `pnpm review:postgres-query-plans -- --output ...`.
- API or SDK readback from `GET /api/v1/admin/postgres/operational-posture`.
- Index decision log.
- Loaded backup/restore report.

Compose and Kubernetes impact:

- Index changes after baseline lock require normal forward migrations and upgrade tests.

Security and migration notes:

- Explain plans and performance logs must not include raw prompts or document bodies.

## HAM-P34-03: Failure Drills And Resilience Controls

Phase: 34 Scale, Performance, And Resilience.

Depends on: Kubernetes install path and worker restart evidence.

Goal: prove Romeo degrades safely and recovers from common infrastructure and provider failures.

Current status: partially implemented. Compose restart and worker-crash recovery evidence already covers app, Valkey, RustFS, Postgres, workflow-resume loop workers, webhook-retry loop workers, and workflow-resume SIGKILL recovery. `pnpm smoke:compose:object-store-outage` now adds a focused RustFS outage drill: baseline attachment readback, object-store stop, bounded attachment read/write failure, failed-write non-persistence, raw-content/log redaction, RustFS restart, original attachment readback, and recovery attachment write/readback. Provider stream exceptions and idle stream timeouts now emit metadata-only `run.failed` events with stable error codes, and focused AI runtime tests prove raw provider exception text, delayed provider text, and raw prompt sentinels are not persisted in runtime events. The idle timeout is wired through `MODEL_PROVIDER_STREAM_TIMEOUT_MS` for config, Compose, and Helm with Helm schema/render-smoke validation. Provider resilience controls are now wired through `MODEL_PROVIDER_RETRY_ATTEMPTS`, `MODEL_PROVIDER_RETRY_BACKOFF_MS`, `MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD`, `MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS`, `MODEL_PROVIDER_DISABLED_IDS`, and `MODEL_PROVIDER_FALLBACK_MODEL_ID`; `pnpm smoke:providers:resilience` proves pre-output retry, no retry after assistant content emits, provider circuit fail-fast, fallback before output, kill-switch fallback without calling the primary provider, and raw provider error redaction. `/api/v1/providers/operational-summary`, SDK, CLI, and app Provider panel coverage now expose provider circuit, fallback, kill-switch, model-count, status, and alert-code metadata without provider endpoints or payloads. `pnpm evidence:provider-outage`, `PROVIDER_OUTAGE_EVIDENCE_PATH`, `GET /api/v1/admin/providers/outage-posture`, and `client.admin.providerOutagePosture()` now provide metadata-only target provider outage evidence generation and mounted readback for outage/timeout injection, circuit opening, fallback/kill-switch routing, provider operational-summary readback, alerting, recovery, warning, and redaction posture without returning raw provider payloads, provider responses, provider errors, prompts, API keys, alert payloads, evidence bodies, or secrets. `pnpm evidence:migration-drill`, `MIGRATION_DRILL_EVIDENCE_PATH`, `GET /api/v1/admin/migrations/drill-posture`, and `client.admin.migrationDrillPosture()` now provide metadata-only failed-migration drill evidence generation and mounted readback for failure injection, migration-job fail-closed behavior, blocked app cutover, rollback/retry recovery, post-recovery schema/app validation, runbook review, warning, and redaction posture without returning database URLs, migration SQL, migration logs, raw error stacks, evidence bodies, or secrets. `pnpm evidence:network-partition`, `NETWORK_PARTITION_EVIDENCE_PATH`, `GET /api/v1/admin/network/partition-posture`, and `client.admin.networkPartitionPosture()` now provide metadata-only network-partition drill evidence generation and mounted readback for dependency/service partition injection, degraded or fail-closed API behavior, worker backpressure without storms, recovery, alerting, CNI/NetworkPolicy context, warning, and redaction posture without returning network endpoints, pod IPs, packet captures, raw log lines, evidence bodies, or secrets. `pnpm evidence:secret-rotation-drill`, `SECRET_ROTATION_DRILL_EVIDENCE_PATH`, `GET /api/v1/admin/secret-rotation/drill-posture`, and `client.admin.secretRotationDrillPosture()` now provide metadata-only target secret-rotation evidence generation and mounted readback for staged session-secret cutover, webhook-signing-key cutover, local MFA and managed-secret envelope rewrap, old/new secret acceptance, dependency credential review, readiness, alerting, warning, and redaction posture without returning secret refs, secret values, tokens, API keys, key material, webhook signing secrets, log lines, evidence bodies, or mounted paths. `pnpm monitoring:export`, `deploy/monitoring/prometheus-rules.yaml`, and `deploy/monitoring/operational-exporter.deployment.example.yaml` now map provider and job operational summaries into a validated Prometheus-compatible metrics and alert contract without exposing raw payloads. `pnpm smoke:alerts:contract` runs the live alert harness against loopback Prometheus and Alertmanager fixtures, proves missing required alert readback fails closed, and writes token-redacted contract evidence. Mounted alert-firing posture now matches every configured required alert name against the Prometheus firing readback before reporting ready while still returning only aggregate counts and stable warning codes. Postgres backup upload PUTs are bounded by `POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS` / `--upload-timeout-ms`, with Compose and Helm backup jobs passing the value explicitly. `pnpm smoke:postgres:backup-upload-failure` now proves backup HTTP failure and connected slow-upload timeout paths exit nonzero, do not write success manifests, and redact presigned URL secrets from output. `/api/v1/jobs/operational-summary` plus `pnpm smoke:jobs:lag` now prove metadata-only queued-lag, stale-running, recent-failure, and dead-letter alert-state calculation without leaking raw job payloads. Executed live provider outage drills, target failed-migration drills, target network-partition drills, target secret-rotation drills, backup-failure alert evidence, live alert firing in the selected monitoring stack, Kubernetes/CNI, and enterprise-tier drills remain open.

Target provider outage, failed-migration, network-partition, and secret-rotation drill evidence can now be promoted to a strict optional Phase 34 GA gate with `pnpm ga:checklist -- --require-target-resilience-drills` or `GA_REQUIRE_TARGET_RESILIENCE_DRILLS=true`. `pnpm ga:target-preflight` maps that gate to the four evidence commands and requires explicit reviewed-evidence confirmations before it reports ready; this does not replace executing the drills in the selected target environment.

Scope details:

- Postgres restart, Valkey restart, object-store outage, provider outage, worker crash, network partition, slow provider, failed migration, failed backup upload, expired secrets, and high queue lag.

Tasks:

- Define expected behavior and alerts for each drill.
- Keep the focused Compose object-store outage drill green.
- Run drills against the target tier.
- Keep provider failure and idle-timeout events metadata-only.
- Keep pre-output provider retry, circuit-breaker, fallback, kill-switch, and redaction evidence green.
- Keep provider operational summary API/SDK/CLI/UI coverage metadata-only and keep the Prometheus operational exporter/rules validation green.
- Keep backup upload timeouts configured for Compose and Kubernetes jobs.
- Keep worker lag, stale-running, and dead-letter summaries metadata-only; add backpressure monitoring as queued worker classes mature.
- Record recovery steps and fixes.

Definition of done:

- Failure drills have documented results.
- Alerts fire for queue lag, backup failure, provider outage, and high error rate.
- Queue-lag alert-state calculation has local API/CLI/CI evidence and is mapped to production alert firing.
- Backpressure prevents worker storms and provider overload.

Testing:

- Failure injection tests.
- Worker crash/retry tests.
- Provider outage and slow-provider tests.
- `pnpm smoke:providers:resilience`.
- `pnpm smoke:jobs:lag`.
- Object-store outage and upload cleanup tests.

Validation and evidence:

- Failure drill report, including `romeo.compose-object-store-outage-smoke.v1`.
- Provider failure redaction and idle-timeout tests for `run.failed` runtime events.
- Provider resilience evidence, including `romeo.provider-resilience-smoke.v1`.
- Target provider outage evidence, including `romeo.provider-outage-evidence.v1`.
- Failed migration drill evidence, including `romeo.migration-drill-evidence.v1`.
- Network partition drill evidence, including `romeo.network-partition-evidence.v1`.
- Secret rotation drill evidence, including `romeo.secret-rotation-drill-evidence.v1`.
- Operational monitoring validation evidence, including `romeo.operational-monitoring-validation.v1`.
- Postgres backup upload failure evidence, including `romeo.postgres-backup-upload-failure-smoke.v1`.
- Alert evidence.
- Recovery runbook updates.

Compose and Kubernetes impact:

- Compose can validate small failure cases; Kubernetes is required for enterprise failure drills.

Security and migration notes:

- Failure logs must stay redacted under error pressure.

## HAM-P35-01: Operator And Developer Documentation Tests

Phase: 35 Documentation, Supportability, And GA Exit.

Depends on: stable Compose, Kubernetes, release, and support paths.

Goal: prove the docs are executable by someone who did not build the feature.

Current status: partially implemented. `pnpm docs:check-commands` now scans the canonical Romeo PRD, package README, `scripts/README.md`, and `docs/**/*.md` for shell blocks and local Markdown links, verifies documented root `pnpm` scripts, workspace filters, Romeo CLI commands, Compose files, Helm/Kubernetes file references, `node scripts/*` commands, and local Markdown file/anchor targets, classifies every documented shell fragment as a checked pnpm/script/CLI/deployment command, an environment-specific operator command, or a known local shell utility, and writes metadata-only `romeo.docs-command-check.v1` evidence. The GA checklist and GA bundle validators now reject stale docs-command evidence that omits `documented_markdown_links_resolve`, `documented_commands_classified`, link-count stats, command-classification posture, or redaction flags for raw markdown bodies, raw shell command text, environment values, and secret values. Remaining work is clean-environment docs-following execution for the selected Compose, Kubernetes, CloudNativePG, release, air-gap, upgrade, rollback, and troubleshooting paths.

Scope details:

- Compose quickstart, Compose self-hosted production, Kubernetes external Postgres, CloudNativePG, air-gapped install, upgrade, backup, restore, DR, rollback, secret rotation, provider outage, failed migration, API/SDK/CLI, connector, worker, and security docs.

Tasks:

- Run docs-following tests from clean environments.
- Mark environment-specific commands explicitly.
- Add link and command checks.
- Verify versioned artifact references.
- Update troubleshooting pages from real failure evidence.

Definition of done:

- Fresh operators can install, upgrade, back up, restore, troubleshoot, and secure Romeo from docs.
- Developers can use API, SDKs, CLI, connector patterns, and worker patterns without reading internal code first.
- Every command is tested or marked environment-specific.

Testing:

- Docs-following test for Compose.
- Docs-following test for Kubernetes external Postgres.
- CloudNativePG path validation where available.
- Air-gapped bundle verification.
- Link and command checks.

Validation and evidence:

- Docs test report.
- Broken-link report.
- Command check report.

Compose and Kubernetes impact:

- Both install paths are first-class; neither should be documented as an afterthought.

Security and migration notes:

- Docs must label development-only settings and migration rollback limits clearly.

## HAM-P35-02: GA Evidence Bundle And Exception Policy

Phase: 35 Documentation, Supportability, And GA Exit.

Depends on: all required phase evidence.

Goal: make GA acceptance objective and auditable.

Current status: partially implemented. `pnpm ga:checklist` now generates `romeo.ga-checklist.v1` evidence from expected `dist/ci` and `dist/release` artifacts, validates optional `romeo.ga-exceptions.v1` exception files, marks missing live evidence as blocked, and exits nonzero in `--strict` mode for promotion gates. The checklist output itself is metadata-only for exceptions: exception input can include owner, approver, rationale, and risk-acceptance text, but generated evidence keeps only gate ID, status, expiry, senior-approval posture, and failure codes. Optional deployment-specific gates can be enabled with `--require-identity-live` / `GA_REQUIRE_IDENTITY_LIVE=true` for reviewed target enterprise identity evidence, `--require-analytics-authz-live` / `GA_REQUIRE_ANALYTICS_AUTHZ_LIVE=true` for reviewed target analytics authorization/export evidence, `--require-target-quality-vector-comparison` / `GA_REQUIRE_TARGET_QUALITY_VECTOR_COMPARISON=true` for Qdrant-enabled target-quality replay comparison proof, `--require-qdrant-live` / `GA_REQUIRE_QDRANT_LIVE=true` for reviewed target Qdrant live-isolation evidence, `--require-qdrant-dr` / `GA_REQUIRE_QDRANT_DR=true` for Qdrant restored-stack consistency, `--require-keda` / `GA_REQUIRE_KEDA=true` for KEDA webhook-retry ScaledJob evidence, `--require-billing-operations-live` / `GA_REQUIRE_BILLING_OPERATIONS_LIVE=true` for reviewed target billing worker/API/alerting evidence, `--require-tenant-purge-live` / `GA_REQUIRE_TENANT_PURGE_LIVE=true` for reviewed target tenant purge and external storage-class evidence, `--require-support-bundle-live` / `GA_REQUIRE_SUPPORT_BUNDLE_LIVE=true` for reviewed target support-bundle evidence, and `--require-target-resilience-drills` / `GA_REQUIRE_TARGET_RESILIENCE_DRILLS=true` for reviewed provider-outage, migration, network-partition, and secret-rotation drills. `GET /api/v1/admin/ga/evidence-posture` and `client.admin.gaEvidencePosture()` now let admins read a mounted/generated checklist through `GA_CHECKLIST_PATH` as a metadata-only posture report with summary counts, sanitized gate status, required live blockers, optional target flags, exception status/expiry only, and redaction flags without exposing absolute mounted paths, evidence file bodies, unsafe raw evidence paths, exception owner/approver/rationale/risk text, or raw evidence content. The same endpoint can read mounted `romeo.ga-target-preflight.v1` evidence through `GA_TARGET_PREFLIGHT_PATH`, exposing sanitized live-gate prerequisite readiness, safe command text, command/env/file/check status, optional target-quality route-comparison readiness, and blocked-preflight warning codes while omitting raw command output, raw environment values, tokens, absolute mounted paths, and evidence bodies. It can also read mounted `romeo.ga-evidence-bundle.v1` manifests through `GA_EVIDENCE_BUNDLE_PATH`, exposing only release name/version, requirement booleans, GA summary, optional target requirement flags, evidence/check counts, blocker codes, and bundle redaction posture while omitting bundle evidence paths, blocker messages, evidence bodies, raw logs, prompts, provider payloads, connector payloads, and secret-like values. `pnpm ga:bundle` now creates a redacted `romeo.ga-evidence-bundle.v1` release manifest that links release manifest, channel, SBOM, security evidence, release provenance, release approval, optional release-readback validation, GA checklist, support-bundle, support-redaction, docs-command, tenant-isolation, and optional extra evidence by hash/status/schema only; final promotion with `--require-checklist-passed` also requires release-readback validation evidence, and operators can require it earlier with `--require-readback-validation`. The airgap verifier now enforces that same readback-validation artifact with `--require-readback-validation` and, when a GA bundle is required, checks the GA bundle digest linkage. The bundle intentionally omits evidence bodies, exception rationale, raw evidence paths, logs, prompts, provider payloads, connector payloads, and secret-like environment values. `pnpm ga:checklist` now validates Compose product, Compose worker, Compose backup/restore, and Kubernetes render evidence beyond schema/status by requiring durable restart readback, worker command/restart/crash-recovery readback, isolated backup/restore evidence paths, and Helm render coverage for schema rejection, worker CronJobs, HPA, NetworkPolicy, CloudNativePG examples, and KEDA examples. It validates tenant-isolation evidence beyond schema/status by requiring every expected negative-test category, the focused core test-file inventory, a zero test exit, and hashed stdout/stderr summaries rather than raw output; it also validates support-bundle redaction evidence by requiring the expected redaction checks, explicit redaction flags, support-bundle metadata, and configured-secret posture for critical runtime secret classes. It now validates local Phase 34 evidence beyond schema/status by requiring provider retry/circuit/fallback/kill-switch behavior, job queued/stale/recent-failure/dead-letter alert readback, provider/job monitoring metric and alert-rule coverage, and failed backup-upload HTTP/timeout non-persistence plus presigned URL redaction. Live target validators now reject missing, future-dated, or stale `generatedAt` for target-quality, Kubernetes live/worker/NetworkPolicy/DR/tiered-RAG/load-soak, live edge, live alert-firing, and optional Qdrant live/DR evidence; load/soak also requires namespace/release/service/deployment target identity. `pnpm smoke:ga:evidence-contract` now uses a temporary synthetic evidence root to prove the checklist accepts a fully shaped live-evidence package and rejects dry-run, missing/stale timestamp, planned, wrong-mode, non-isolated, missing package/image/chart/release-asset readback verification, missing-worker-crash, missing-eval-gate, missing-replay, missing target-quality vector-comparison proof, single-run, missing-policy-restore, missing-scaler-readback, raw exception leakage, raw tenant-test output, missing tenant-isolation vector coverage, missing support-bundle configured-secret posture, missing support-bundle generation evidence, missing Qdrant live-isolation proof, missing tenant-purge external storage-class review, missing provider resilience kill-switch fallback, missing job dead-letter alert, missing monitoring provider metrics, missing backup-upload timeout evidence, and missing-log-redaction evidence for the target-quality, live Kubernetes, Kubernetes worker CronJob/crash recovery, Kubernetes NetworkPolicy/CNI enforcement, optional KEDA scaler, Kubernetes DR, credentialed release readback, Kubernetes tiered-RAG, optional Qdrant live-isolation, optional tenant-purge live gate, optional support-bundle live gate, live edge enforcement, live alert-firing, and Kubernetes load/soak gates. The draft checklist remains blocked until target-quality capture, live Kubernetes, Kubernetes worker CronJob/crash recovery, NetworkPolicy/CNI enforcement, CloudNativePG/external Postgres DR, credentialed release readback, Kubernetes tiered-RAG isolation, live edge/WAF/API-gateway enforcement, alert-firing, and Kubernetes load/soak evidence are collected in the selected target environment. Target quality, Kubernetes workers, Kubernetes tiered-RAG, Kubernetes load/soak, live NetworkPolicy/CNI enforcement, optional target-quality vector comparison, optional live Qdrant isolation, optional live tenant purge enforcement, optional live support-bundle enforcement, optional live KEDA scaler enforcement, live edge enforcement, and live alert firing now have guarded harnesses with strict GA evidence validation, but they still need execution in a reachable selected-tier API, cluster, edge, vector, and monitoring stack.

Latest local validation for the GA evidence bundle, release-readback, airgap, and exception-redaction gate slice passed script syntax, docs-command evidence, support-bundle generation, positive `pnpm ga:bundle`, positive bundle generation with required loopback readback-validation linkage, missing-readback-validation failure injection, `--require-checklist-passed` failure injection, positive airgap verification with required loopback raw readback and loopback readback-validation linkage, airgap missing-readback-validation failure injection, GA evidence-contract smoke with missing image/chart/asset readback failure injection and raw exception leak rejection, strict greenfield baseline review, Kubernetes render smoke, draft GA checklist generation, and broad `pnpm check`, `pnpm lint`, `pnpm test`, and `pnpm build`. The bundle passes in release-candidate mode and correctly blocks in final-promotion mode until the remaining live target-environment gates are satisfied; default final-promotion readback filenames remain reserved for target evidence, and no migration files were added.

Latest local validation for the admin GA bundle posture readback passed focused config/core/API-client checks and tests, SDK drift, OpenAPI route coverage, docs command checks, Compose config render, Kubernetes render smoke, strict greenfield baseline review, Drizzle generation, GA target-preflight contract smoke, GA evidence-contract smoke, draft checklist generation, target preflight generation, broad `pnpm check`, broad `pnpm lint`, broad `pnpm test`, and broad `pnpm build`. The draft checklist still reports 15 of 25 gates satisfied with 10 live target-environment blockers, and Drizzle reported no schema changes.

Scope details:

- GA checklist, evidence bundle, exception approvals, residual risk, release version references, support contacts, rollback limits, and target deployment tier.

Tasks:

- Create `ga-checklist.json` or equivalent release evidence.
- Generate `ga-evidence-bundle.json` so the release has one redacted, hash-linked evidence manifest, including release-readback validation evidence for final promotion.
- Mount or configure `GA_CHECKLIST_PATH` only when the running admin API should display sanitized checklist posture; mount `GA_TARGET_PREFLIGHT_PATH` only after generated preflight evidence has been reviewed as metadata-only; mount `GA_TARGET_PLAN_PATH` only after generated target-plan evidence has been reviewed as metadata-only; mount `GA_TARGET_EXECUTION_PATH` only after generated target-execution evidence has been reviewed as metadata-only command-hash/status evidence; mount `GA_EVIDENCE_BUNDLE_PATH` only for a reviewed metadata-only `romeo.ga-evidence-bundle.v1` manifest.
- `GA_TARGET_PLAN_PATH` and `GA_TARGET_EXECUTION_PATH` now expose ordered phase/gate planning, operator-action states, command hashes, execution status/timing, skip/failure reasons, and safe env-file metadata counts through `GET /api/v1/admin/ga/evidence-posture` and `client.admin.gaEvidencePosture()`. The API omits raw command text, command output, env-file values, env-file bodies, raw target-plan check bodies, tokens, unsafe paths, and mounted evidence bodies.
- Link evidence from every required phase.
- Keep GA evidence validator contract smoke in CI so planned or malformed evidence cannot replace live target evidence.
- Record exceptions for conditional phases not shipped.
- Require owner, expiry, rationale, and risk acceptance for exceptions.
- Verify release artifacts, docs, and runbooks point to the same version.

Definition of done:

- No GA-blocking item remains open without explicit approved exception.
- Evidence is tied to immutable release artifacts.
- Conditional phase exclusions are intentional and visible.

Testing:

- GA checklist validation.
- Evidence link/readback checks.
- Exception policy tests or review checklist.

Validation and evidence:

- `ga-checklist.json`.
- `ga-evidence-bundle.json`.
- `readback-validation.json`.
- `airgap-bundle-verification.json`.
- Approved exception register, if any.

Compose and Kubernetes impact:

- GA evidence must include Compose and Kubernetes results appropriate to the target market.

Security and migration notes:

- Exceptions involving security, migrations, backup/restore, or tenant isolation require explicit senior approval before GA.
