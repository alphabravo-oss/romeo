# Execution Backlog: Product Capabilities

This file covers Phase 24 through Phase 31. These phases should be pulled forward only after their security, storage, and worker boundaries are ready.

## HAM-P24-01: Delegated OAuth Registry And Connection Flow

Phase: 24 Delegated Connector OAuth.

Depends on: durable Postgres baseline and managed secret references.

Goal: support user-delegated OAuth connectors without exposing token material.

Current status: implemented as a usable API foundation with initial GitHub connector runtime use. Romeo now has a delegated OAuth provider registry for GitHub, `GET /api/v1/delegated-oauth/providers`, `POST /api/v1/delegated-oauth/start`, a public callback that exchanges GitHub codes, encrypted server-side token storage, redacted connection list/revoke APIs, `GET /api/v1/admin/delegated-oauth/posture` for metadata-only admin provider and connection health posture, audit events, provider-side GitHub grant revocation, server-side callback replay rejection through a metadata-only durable replay guard, OpenAPI/TypeScript SDK/Python SDK coverage, and Compose/Helm configuration for client ID, client secret, token encryption key, and allowed scopes. The public connection summary returns connection IDs, provider IDs, status, scope arrays, timestamps, stable provider-account hashes, and provider-login presence/hash metadata only; raw provider account IDs and logins remain internal and are not returned through list, revoke, access-review, sync summary, job, or audit readback. The admin posture report returns provider configured state, connector-type aggregate counts, active/revoked/reauthorization/expiry posture, warning codes, and explicit redaction flags without raw tokens, refresh tokens, client secrets, provider account IDs/logins, or raw provider URLs. GitHub connectors can select a delegated connection through `config.delegatedOAuthConnectionId`; connector create rejects simultaneous `secretRef` and delegated OAuth credentials, runtime use is bound to the connector owner/workspace/type, revoked or reauthorization-required connections fail sync closed, and expired tokens refresh under a repository-backed refresh lock with provider-returned refresh-token rotation when a refresh token exists. The start path fails closed when the provider is not fully configured, scopes are unsafe or outside the allowed list, the caller is not a user, or the workspace is outside caller access. The API response returns only redirect and connection metadata; PKCE verifier/state stays in a short-lived HttpOnly cookie, callback state replay is rejected before provider token exchange, and token material is not returned through API responses, sync summaries, jobs, or audit metadata. UI connection management polish remains open.

Scope details:

- OAuth provider registry, admin app configuration, authorization-code with PKCE, signed state, nonce, callback handling, and connection ownership.

Tasks:

- Model provider metadata and admin OAuth app configuration.
- Add start and callback APIs with state, nonce, PKCE, return path, and expiry.
- Bind completed connections to user, org, workspace, and connector type.
- Store only sanitized provider account metadata outside the secret store.
- Add UI management paths for connection list, status, metadata-only admin posture, provider-backed revoke, GitHub connector credential selection, and reauthorize affordances.

Definition of done:

- At least one reviewed provider can connect through PKCE.
- State, nonce, redirect, issuer, tenant, and replay failures are rejected.
- API responses, audits, jobs, logs, and sync summaries do not include tokens.
- Admin posture reports aggregate health only and do not include raw tokens, client secrets, provider account IDs/logins, or raw provider URLs.

Testing:

- State/nonce/PKCE/expiry tests plus server-side replay hardening evidence.
- Cross-user and cross-workspace authorization tests.
- UI/API/SDK/CLI request tests.
- Redaction tests.
- Admin posture aggregate-count and redaction tests.

Validation and evidence:

- OAuth flow test report.
- Token redaction scan.
- Provider setup documentation for Compose and Kubernetes ingress.

Compose and Kubernetes impact:

- Redirect URL docs must cover localhost Compose and Kubernetes ingress/TLS.

Security and migration notes:

- Refresh tokens must be stored only through approved managed-secret or encrypted server-side storage.

## HAM-P24-02: Delegated Token Refresh, Revocation, And Connector Use

Phase: 24 Delegated Connector OAuth.

Depends on: HAM-P24-01.

Goal: make delegated credentials usable by connector workers with safe refresh and revocation.

Current status: implemented for GitHub connector runtime use at the API/service layer. Repository-backed refresh locking, refresh-token rotation, revoked/reauthorization fail-closed checks, credential-source exclusivity, durable `lastUsedAt` persistence, provider-side GitHub grant revocation, server-side callback replay rejection, and delegated GitHub connector sync are covered by focused API tests and repository conformance. UI-driven connection selection remains open.

Scope details:

- Token refresh locking, refresh-token rotation, provider-side revocation, reauthorization-required state, connector credential selection, and multi-replica safety.

Tasks:

- Maintain repository-backed refresh locking to prevent token storms across app instances.
- Rotate refresh tokens when providers return replacements.
- Make revoked/reauthorization-required state visible to workers.
- Allow connectors to select deployment secret, managed connector secret, delegated OAuth connection, or no auth.
- Fail connector sync closed when required delegated credential is missing, revoked, or expired without refresh.
- Maintain provider-side revocation when providers expose a safe revocation endpoint.

Definition of done:

- Expired tokens refresh once under concurrency through the repository refresh-lock boundary.
- Revoked connections cannot be used by workers.
- Failed refresh enters reauthorization-required state.
- GitHub connector sync can use `delegatedOAuthConnectionId` without exposing token material.

Testing:

- Concurrent refresh tests, including separate service instances sharing the repository lock.
- Refresh success, refresh failure, expired-without-refresh-token, and revocation tests.
- Connector sync with delegated credential tests.
- Redaction tests for worker logs and sync summaries.

Validation and evidence:

- Refresh storm test evidence through the two-service delegated OAuth refresh test and repository conformance.
- Provider-side revocation readback evidence through focused API tests.
- Sync redaction evidence for delegated connector tokens.

Compose and Kubernetes impact:

- Worker Secret scopes must allow only the secret paths needed for delegated connector execution.

Security and migration notes:

- Access tokens should stay transient in worker memory.

## HAM-P25-01: Tool Dispatch Queue Contract

Phase: 25 Out-Of-Process Tool Execution Workers.

Depends on: durable jobs and metadata-only dispatch request foundation.

Goal: define durable, metadata-only tool dispatch jobs with safe claim and readback behavior.

Current status: partially implemented. Metadata-only `tool.operation.dispatch_request` enqueue and sanitized completion/failure readback already existed; the queue now supports repository-level claim, lease renewal, timeout expiry, idempotent enqueue replay, and cancellation without a new migration, using only sanitized metadata in the existing job payload. The public API, OpenAPI contract, TypeScript SDK, generated Python SDK, and CLI expose idempotent enqueue, claim, renew, expire, and cancel operations. Completion/failure readback now requires the caller to hold an active lease, operator cancellation stores only `worker_cancelled`, batch expiry stores only `worker_dispatch_request_expired`, and enqueue idempotency stores only a scoped key hash plus stable request-shape metadata. A request reclaimed after three stale worker leases is failed with `worker_attempts_exhausted`, metadata-only `deadLetter` details, sanitized audit metadata, and dead-letter visibility through the job operational summary, monitoring exporter, and alert rules. Focused tests cover claim, renewal, wrong-worker denial, expired-job reclaim, API readback replay rejection, queued cancellation, terminal replay rejection after cancellation, max-attempt dead-lettering, timeout-expiry of queued and lease-timed-out requests, idempotent enqueue replay/conflict/redaction, CLI enqueue/claim/renew/expire/cancel payloads, SDK endpoint coverage, and Postgres repository conformance. Compose worker crash evidence exists for workflow-resume SIGKILL recovery. `pnpm smoke:kubernetes:workers` now provides the guarded live Kubernetes harness for core worker CronJob execution and workflow-resume pod crash recovery, and the GA checklist rejects missing or dry-run worker evidence. Remaining HAM-P25-01 work is executing that harness against a reachable selected cluster plus broader future worker-class crash cases as new queues land.

Scope details:

- Queued, claimed, running, succeeded, failed, cancelled, expired, and dead-letter states.
- Claim lease, renewal, max attempts, timeout, idempotency key, and sanitized result metadata.

Tasks:

- Implement queue state transitions and terminal-state guards.
- Add atomic claim and lease renewal.
- Add cancellation and expiry behavior.
- Add dead-letter inspection with metadata-only errors.
- Keep raw request payloads outside general app persistence.

Definition of done:

- Workers cannot double-complete terminal jobs.
- Crashed jobs become reclaimable after lease expiry.
- Readback replay is rejected.

Testing:

- Claim, lease, renewal, expiry, retry, cancellation, and terminal-state tests.
- Duplicate readback tests.
- Metadata redaction tests.

Validation and evidence:

- Queue conformance report.
- Crash/reclaim test evidence.

Compose and Kubernetes impact:

- Queue contract supports Compose worker profile and Kubernetes worker Deployment or CronJob.

Security and migration notes:

- Any new queue tables belong in the baseline until Phase 19 is locked.

## HAM-P25-02: Tool Dispatch Worker And Egress Policy

Phase: 25 Out-Of-Process Tool Execution Workers.

Depends on: HAM-P25-01.

Goal: execute real tool operations only in a scoped worker boundary.

Current status: partially implemented. `romeo workers tool-dispatch` now exists as a bounded worker loop. With no payload file configured it claims only `managed_encrypted_object_store` jobs and reads raw execution payloads through the active-lease payload API; with `--payload-file`, it can also read raw parameters, body values, string headers, and optional bearer/API-key/OAuth client-credentials auth metadata from an external JSON file keyed by dispatch job ID. The worker can resolve auth secret values only inside the worker when `--secret-resolver env|vault|aws-sm|gcp-sm|azure-kv|cloud` is enabled; the default disabled resolver fails auth closed. OAuth token URL, scopes, client-auth method, and MCP Streamable HTTP transport hints come from sanitized claim metadata, while payloads supply only the managed secret ref and raw arguments. The worker claims dispatch-request leases through the public API, receives sanitized OAuth token policy plus JSON response-schema subsets when imported operations declare them, renders path/query parameters, wraps MCP Streamable HTTP jobs as `tools/call` JSON-RPC requests from metadata-only transport hints, executes HTTPS requests only, fails closed on redirects, denies local/private literal hosts, DNS-resolved private/link-local/reserved addresses, and Kubernetes service DNS names by default, applies fetch timeout and response-byte limits, validates bounded JSON response bytes locally, completes jobs with metadata-only response readback, and fails missing payloads with `worker_payload_unavailable`. Focused tests cover disabled no-payload behavior when no payload source API exists, successful execution without printing raw payloads or response bodies, managed-payload claim filtering and active-lease payload reads, MCP `tools/call` envelope generation/redaction, bearer/API-key/OAuth worker auth redaction, missing-secret failure before fetch, missing-payload failure, unsafe literal-host denial before fetch, DNS-resolved private-host denial before fetch, DNS lookup failure mapping, timeout mapping, response truncation without body output, response schema pass/fail/invalid-JSON/truncated handling, redirect failure mapping, Vault/AWS/GCP/Azure/cloud resolver behavior, and the command wrapper/payload-file contract. `pnpm smoke:tool-dispatch:acceptance-contract` now provides local backend/API acceptance evidence for disabled no-payload fail-closed behavior, managed payload claim/read/complete, MCP Streamable HTTP JSON-RPC wrapping, worker-only secret resolution, private DNS denial before fetch, missing-secret denial before fetch, response-schema metadata, invalid-response redaction, worker-output redaction, and dispatch-readback redaction; CI and the Phase 32 backend-capability GA gate validate the resulting `romeo.tool-dispatch-acceptance-contract-smoke.v1` evidence. `pnpm evidence:tool-dispatch-live`, `TOOL_DISPATCH_LIVE_EVIDENCE_PATH`, `GET /api/v1/admin/tool-dispatch/posture`, and `client.admin.toolDispatchPosture()` now provide sanitized mounted readback for reviewed live worker, managed-payload, MCP protocol/envelope/redaction, CNI/NetworkPolicy, DNS, secret-resolution, retry/reclaim, schema-validation, readback, and log-redaction evidence. Compose now has an opt-in `tool-dispatch` profile with explicit resolver driver and resolver env wiring, and Helm can render a `workers.toolDispatch` CronJob with an optional Secret-mounted payload file, schema-validated resolver driver, optional resolver credentials from the runtime Secret, and a separate `workers.toolDispatch.networkPolicy` egress policy that is validated by the Kubernetes render smoke. `pnpm smoke:kubernetes:workers` covers the core always-on worker CronJobs; tool-dispatch remains opt-in because it requires selected egress policy and managed/external payload setup. Remaining work: execute the selected live tool-dispatch evidence in the target deployment, including CNI/NetworkPolicy egress enforcement, DNS-rebinding evidence, and live worker log/NetworkPolicy evidence where that worker is enabled.

Tool connector type posture is now exposed through metadata-only `GET /api/v1/tool-connectors/catalog` and `client.tool.catalog()`. Built-in tools, imported OpenAPI operations, single-operation webhook tool connectors, and Streamable HTTP MCP manifest connectors are reported as implemented; browser automation is reported as a separate workflow API; and enterprise tool connector types remain planned with stable blocker codes until reviewed runtimes exist. Webhook tool connector creation is available through `POST /api/v1/tools/webhook` and `client.tool.createWebhookConnector(...)`; it validates HTTPS targets, rejects query-string secrets, creates disabled connector/operation records, derives a host allowlist, and uses the existing external dispatch worker boundary for execution. MCP connector creation is available through `POST /api/v1/tools/mcp` and `client.tool.createMcpConnector(...)`; it accepts a reviewed static tool manifest for an HTTPS Streamable HTTP endpoint, rejects query-string or unsafe/local/private server URLs, creates disabled connector/operation records, derives a host allowlist, and sends execution through the same approval, activation, network-policy, managed-secret, and external worker gates. MCP stdio and local command transports are intentionally unsupported.

Scope details:

- Worker command, authenticated worker API, scoped secret resolution, HTTP egress allowlist, timeout, size limits, redirect policy, private-network denial, response validation, and sanitized readback.

Tasks:

- Add `romeo workers tool-dispatch`.
- Resolve raw payloads and connector secrets only in the worker.
- Enforce allowlist and deny private, localhost, link-local, metadata-service, and cluster ranges by default.
- Bound method, timeout, response bytes, redirects, and content type.
- Add Compose profile and Kubernetes worker template.

Definition of done:

- App pods can enqueue metadata-only jobs without connector secret access.
- Worker logs and readbacks do not expose payloads, headers, tokens, or response bodies.
- Default deployment leaves real execution disabled.

Testing:

- Worker egress allowlist and denial tests.
- Timeout, response-size, redirect, invalid response, and schema tests.
- Secret resolver tests in worker-only context.
- Compose and Kubernetes worker smoke.

Validation and evidence:

- `romeo.tool-dispatch-acceptance-contract-smoke.v1` local backend/API worker-boundary evidence.
- Worker security test report.
- Network denial evidence.
- Redacted worker logs.

Compose and Kubernetes impact:

- Kubernetes NetworkPolicy must be able to restrict worker egress separately from app egress.

Security and migration notes:

- Do not mount broad application secrets into tool workers.

## HAM-P26-01: Live Model Tool-Call State Machine

Phase: 26 Live Model-Driven Tool Orchestration.

Depends on: Phase 25 worker boundary.

Goal: let model providers request tool calls and resume generation through approved, durable state transitions.

Current status: partially implemented with bounded inline autonomous execution, metadata-only imported-operation dispatch enqueue, backend/API managed encrypted payload handoff, active-lease worker payload retrieval, durable approval wait/resume/approve/cancel/reject, worker-dispatch wait/resume, queued-dispatch cancellation for OpenAI-compatible Chat Completions, OpenAI Responses-compatible, and Ollama model tools, and native Romeo file/object storage. Romeo now exposes `POST /api/v1/runs/{runId}/tools/{toolId}/execute` plus TypeScript SDK support for run-scoped model tool calls. The route reuses the existing agent tool binding, approval, quota, audit, tool-call record, and sanitized run-event path, derives the agent from the run, and accepts a provider `modelToolCallId` as a duplicate side-effect guard. Replay protection uses the existing `background_jobs` ledger with scoped hashes and metadata-only payloads; raw provider call IDs and raw tool arguments are not persisted in jobs or run events. Provider tool-call normalization now covers OpenAI-compatible chat `tool_calls`, Responses-style `function_call` items, and Ollama `message.tool_calls`. The OpenAI-compatible chat adapter uses resolved managed provider credentials for real `/chat/completions` SSE streaming, emits provider-reported usage, normalizes streamed tool-call chunks including same-turn batches, serializes assistant/tool continuation messages for Chat Completions, keeps deterministic dev echo only for uncredentialed local providers, and fails closed when a configured credential cannot be resolved. Romeo also exposes default stateless inbound OpenAI-compatible model/chat/embedding routes plus native inline, direct-upload, backend-composed resumable-upload, and grant-sharing file APIs under `/api/v1/files`; OpenWebUI-shaped boot/session/sidebar/channel reference routes are disabled by default and require `OPENWEBUI_COMPATIBILITY_ENABLED=true`. Native inline uploads are bounded base64 payloads; direct-upload sessions return short-lived object-store PUT URLs; resumable sessions return short-lived object-store PUT URLs for bounded parts, compose the final object server-side, verify part sizes plus final size/digest/MIME signature, delete staged parts, and mark `object_records` metadata available without adding tables. File APIs enforce owner grants, explicit file read/write shares, `files:read`/`files:write`, workspace scope, and metadata-only audit while omitting raw object-store keys. OpenWebUI exact-route parity remains opt-in compatibility work, so OpenWebUI-shaped file/config/retrieval/tools/functions/prompts/media routes and native Socket.IO/WebSocket transport are not automatic backend requirements. The OpenAI Responses-compatible adapter is a first-class provider kind with default capabilities, provider creation/sync API support, `/responses` SSE streaming with `store:false`, Responses input-item serialization for function calls and function-call outputs, streamed text/usage normalization, fragmented function-call argument normalization, and adapter-specific continuation. The Ollama adapter now uses `/api/chat` for JSON-line streaming text, token counters, tool definition injection, returned tool-call normalization, assistant/tool continuation serialization, optional bearer auth, and configured-credential fail-closed behavior while preserving deterministic dev echo in hermetic tests. Provider create/list responses expose only `credentialConfigured` and `credentialRefScheme`, never raw refs. Authorization-filtered schemas for enabled, granted built-in agent tools and agent-bound worker-ready imported OpenAPI operations are injected into OpenAI-compatible Chat Completions, OpenAI Responses-compatible, and Ollama requests for tool-capable provider/model pairs, and the runtime forwards active provider credentials/fetch options across primary and fallback attempts. Imported operation tool names use the operation row ID, validate a `{ parameters, body }` envelope, and enqueue the existing `tool.operation.dispatch_request` job with connector/operation IDs, method/path, host, key names, approval metadata, worker queue, payload-storage posture, run linkage metadata, subject posture, and idempotency hash only; when `TOOL_DISPATCH_PAYLOAD_STORE_DRIVER=object-store` is enabled, raw operation payloads and worker auth refs are written only to encrypted object-store envelopes before queueing and then retrieved only by the active worker lease. The runtime emits sanitized `tool.requested` events, executes bounded single or batched non-approval built-in model-requested tools through the same run-scoped `ToolService` path, resumes provider generation with bounded tool result content, enforces a fixed model-tool-call limit, moves approval-gated model tool calls into `waiting_tool_approval`, surfaces server-issued approval request IDs in metadata-only events, exposes caller-owned pending approvals as unified metadata-only summaries for built-in tool calls and imported operation dispatches, emits metadata-only `run.continuing` events when approved tool calls or worker dispatch readbacks resume generation, resumes provider generation after approved run-scoped tool execution using the server approval ID as a synthetic continuation call ID, records caller-owned approval/cancel/reject decisions through `POST /api/v1/tool-approvals/{approvalRequestId}/approve|cancel|reject` with metadata-only decision state, removes decided approvals from the pending queue, terminalizes waiting built-in approval runs with sanitized `tool.failed` plus `run.cancelled` events on cancel/reject, blocks cancelled/rejected imported-operation approval replay before network execution, moves model-requested imported operations into a metadata-only `run.waiting_tool_dispatch` wait, resumes provider generation after worker completion/failure readback using the dispatch job ID as the synthetic continuation call ID, cancels linked queued/running dispatch jobs when the run is cancelled, blocks future run-scoped tool execution after completed/failed/cancelled runs, and appends a terminal `run.cancelled` event when suspended approval or dispatch waits are cancelled. `pnpm smoke:model-tools:orchestration-contract` now provides local backend/API acceptance evidence for OpenAI-compatible model tool-call normalization and continuation, authorized tool-schema injection, metadata-only run events, imported-operation dispatch wait/resume, worker-readback continuation by dispatch job ID, managed encrypted dispatch-payload redaction, approval reject terminalization, pending-approval metadata readback, and raw-value redaction; CI and the Phase 32 backend-capability GA gate validate the resulting `romeo.model-tool-orchestration-contract-smoke.v1` evidence. Release-candidate eval evidence now reports aggregate expected-tool-call and expected-tool-outcome pass/fail counts plus failed tool-expectation case counts without returning raw tool names, arguments, output keys, error codes, or result bodies. Raw provider call IDs, raw arguments, raw operation parameters/body values, managed payload object keys, raw worker response bodies, file object keys, and raw tool results stay out of jobs and run events. Remaining HAM-P26-01 work is UI progress polish, target eval evidence, future provider-specific continuation beyond OpenAI-compatible, Responses-compatible, and Ollama if additional tool-capable adapters are introduced, broader explicitly approved compatibility routes, optional provider-native object-store multipart optimization if target evidence needs it, and live deployment evidence for the worker boundary.

Scope details:

- OpenAPI now names core chat records, native chat tags, native workspace folders/items, native collaboration channels/members/messages/events, messages, message attachments, assistant-message feedback state, native chat deletion preview/result schemas, chat comments, file objects, file upload sessions, run records, approval summaries, approval decision responses, run events, and `run.continuing` event payload schemas while omitting OpenWebUI-shaped bridge-only schemas from the default Romeo contract, with redaction notes for tag assignment audit label redaction, folder audit label/sidebar-metadata redaction, channel audit name/body redaction, deletion count-only responses, message feedback content/reviewer redaction, raw arguments, provider call IDs, payload object keys, file object keys, secrets, and response bodies.
- Provider tool-call normalization, argument schema validation, approval state, dispatch job link, worker readback, continuation state, cancellation, and retry safety.

Tasks:

- Normalize tool calls across supported providers; OpenAI-compatible chat, streamed chat chunks, Responses item normalization, and Ollama `message.tool_calls` normalization are implemented.
- Inject authorization-filtered registered tool schemas into tool-capable provider requests; OpenAI-compatible Chat Completions, OpenAI Responses-compatible, and Ollama chat request injection is implemented for built-ins and agent-bound worker-ready imported OpenAPI operations.
- Validate function names and arguments before approval or dispatch.
- Maintain run states for waiting approval, waiting execution, continuing, completed, failed, and cancelled; `waiting_tool_approval` is implemented for approval waits, `run.waiting_tool_dispatch` is implemented for worker dispatch waits using the existing queued run state, and `run.continuing` is emitted when approved tools or worker readback resume generation.
- Persist tool-call timeline metadata without secrets or raw hidden values.
- Make resume idempotent.
- Keep the run-scoped execution API as the stable UI/provider boundary while provider adapters and worker dispatch are completed.

Definition of done:

- Invalid model-requested tools fail closed.
- Approved inline calls resume OpenAI-compatible Chat Completions, OpenAI Responses-compatible, and Ollama provider generation; external or networked tool calls enqueue metadata-only dispatch requests, wait for worker completion/failure readback, then resume provider generation with sanitized readback metadata.
- Cancellation prevents future inline run-scoped execution and continuation, and cancelling a run waiting on queued/running worker dispatch terminalizes the linked dispatch job with metadata-only cancellation details.

Testing:

- Provider normalization tests.
- Argument schema failure tests.
- Approval wait/resume, terminal run denial, dispatch, readback, cancellation, and retry tests.
- Audit redaction tests.
- Run-scoped tool execution and replay tests for provider call IDs.

Validation and evidence:

- `romeo.model-tool-orchestration-contract-smoke.v1` local backend/API state-machine evidence.
- Tool orchestration state-machine report.
- Duplicate side-effect prevention evidence.
- Focused API evidence for metadata-only model tool-call replay guards, imported-operation dispatch enqueue redaction, approval wait/resume, worker readback resume, queued dispatch cancellation, terminal run denial, and suspended-run cancellation.

Compose and Kubernetes impact:

- Inline OpenAI-compatible built-in tool orchestration can run when provider credentials and egress are approved. External or networked model-requested operations are exposed only when operation execution readiness gates pass, enqueue metadata-only dispatch requests, optionally store raw payloads as encrypted object-store envelopes, wait on `run.waiting_tool_dispatch`, and resume after sanitized worker readback; actual worker execution still requires deployment-specific egress configuration and live evidence in Compose or Kubernetes.

Security and migration notes:

- Model-provided arguments are untrusted input.

## HAM-P26-02: Tool Approval UX, SDK, CLI, And Eval Support

Phase: 26 Live Model-Driven Tool Orchestration.

Depends on: HAM-P26-01.

Goal: expose live tool calls to users and evaluators without leaking hidden payloads.

Current status: partially implemented. The API and TypeScript/Python SDK now expose metadata-only pending approval listing plus caller-owned approve/cancel/reject decisions through `GET /api/v1/tool-approvals`, `POST /api/v1/tool-approvals/{approvalRequestId}/approve`, `/cancel`, `/reject`, `client.tool.approvals(...)`, `client.tool.approveApproval(...)`, `client.tool.cancelApproval(...)`, and `client.tool.rejectApproval(...)`; approved execution still uses the existing run-scoped tool execution contract with user-approved input so raw arguments are not persisted in approval records. Pending approval summaries now cover both built-in tool-call approvals and imported operation dispatch approvals with `source`, tool metadata, risk, approval policy, input key names, connector/operation context, available actions, requested time, and expiry while excluding raw arguments and payload values. Decision tests cover queue removal, replay denial after cancel/reject, metadata-only audit, waiting-run terminalization for built-in run cancellation/rejection, and imported-operation cancel/reject replay denial before network execution. Eval rubrics now support `expectedToolOutcomes` for metadata-only outcome assertions using tool name, optional success/failure status, expected output-key subset, and stable error code; release-candidate evidence aggregates expected-tool-call and expected-tool-outcome pass/fail counts plus failed tool-expectation case counts while redacting raw tool names, arguments, output keys, error codes, and result bodies. Focused tests cover pass/fail scoring and evidence redaction without storing raw tool result bodies. Remaining HAM-P26-02 work is UI affordances and target/live eval evidence.

Scope details:

- Pending approval UI, run progress, CLI and SDK approval methods, eval expected-tool assertions, and sanitized audit timeline.

Tasks:

- Add approval list/detail UI with tool name, connector, risk, argument keys, expected effect, and expiry.
- Keep approve/reject/cancel APIs in OpenAPI and SDKs; add CLI commands only if the CLI returns to scope.
- Keep run progress events for waiting and continuing states covered in UI/evidence; backend `run.waiting_tool_approval`, `run.waiting_tool_dispatch`, and `run.continuing` events are implemented.
- Add eval cases for expected tool-call plans and outcomes.
- Add redaction checks for approval screens and exports.

Definition of done:

- Users can inspect, approve, reject, or cancel pending tool calls.
- Evals can assert expected tool behavior.
- Hidden secrets and redacted arguments are not displayed.

Testing:

- UI tests for pending approval and continuation.
- SDK and CLI request tests.
- Eval pass/fail tests.
- Approval expiry and rejection tests.

Validation and evidence:

- UI smoke evidence.
- Eval evidence.
- Audit timeline sample.

Compose and Kubernetes impact:

- No deployment-specific UI differences.

Security and migration notes:

- Approval text must not contain raw secrets or full request bodies.

## HAM-P27-01: Connector Intake And Adapter Framework

Phase: 27 Connectors And Sync Expansion.

Depends on: Phase 24 for delegated auth where needed and Phase 25 for risky execution.

Goal: add connectors through a repeatable secure intake process rather than one-off service logic.

Current status: partially implemented. Romeo now has a metadata-only data connector catalog through `GET /api/v1/data-connectors/catalog`, `client.dataConnectors.catalog()`, OpenAPI, and the generated Python SDK. The catalog covers every supported connector type, exposes typed config keys, sync mode, execution boundary, credential source categories, egress posture, fetch timeout/byte/retry limits, runtime driver posture, stable blocked reasons, and credential posture booleans without allowed-host values, endpoint URLs, secret refs, tokens, or credentials. `docs/data-connector-intake.md` now defines the connector intake checklist. Connector creation consults the catalog so future connector types must be cataloged before implementation, and managed connector creation rejects runtime-blocked types with `409 connector_runtime_not_configured` plus stable blocked reason codes rather than persisting unsyncable outbound connectors. Website/RSS/Atlassian/Notion/Linear/Slack execution now supports production DNS lookup before fetch and rejects DNS-resolved private/link-local/reserved hosts before network egress, with focused tests proving the guard fires before fetch. Managed website/RSS, GitHub, S3, Confluence, Jira, Notion, Linear, and Slack fetches share bounded retry/backoff handling for 429, 500, 502, 503, 504, and exhausted GitHub-style rate-limit responses while honoring `Retry-After`; focused tests prove retry success paths do not copy transient response bodies, raw CQL/JQL, raw Notion/Linear filter queries, raw Slack channel IDs, connector content, or token material into sync outputs. Confluence uses bounded CQL with connector secret refs, Jira uses bounded JQL with connector secret refs, Notion uses bounded page search plus bounded block-child reads with connector secret refs, Linear uses a fixed bounded GraphQL issue query with connector secret refs, Slack uses bounded `conversations.history` reads for explicit channel IDs with connector secret refs, and sync summaries return query/channel hashes rather than raw query text or channel IDs. `pnpm smoke:data-connectors:acceptance-contract` now adds CI evidence that the API catalog is complete and sanitized, managed outbound creation fails closed when runtime posture is incomplete, ambiguous GitHub credential-source selection is rejected, local-import sync works without outbound runtime, private DNS website targets are denied before fetch, Confluence/Jira secret-ref sync works through the Atlassian executor, Notion secret-ref sync works through the Notion executor, Linear secret-ref sync works through the Linear executor, Slack secret-ref sync works through the Slack executor, and the artifact omits raw hosts, endpoint URLs, CQL/JQL/search/filter/channel strings, secret refs, tokens, connector content, and connector config. Remaining work is first customer connector acceptance, live worker/CNI evidence, and broader connector packages tied to selected customer/provider requirements.

Scope details:

- Connector brief, threat model, typed adapter, shared HTTP/retry/allowlist/redaction helpers, incremental cursor, tombstone policy, and docs.

Tasks:

- Create a connector intake template.
- Create adapter module structure and tests.
- Define data classification and storage target per connector.
- Require egress allowlist and credential source.
- Document deletion and permission behavior.

Definition of done:

- Each connector has threat model, typed config, tests, docs, and redaction review.
- Sync can resume without duplicate imports.
- Credential values are never exposed.

Testing:

- Adapter unit tests with mocked provider responses.
- Sync idempotency and cursor tests.
- Rate-limit and retry tests.
- Permission and deletion tests.

Validation and evidence:

- `romeo.data-connector-acceptance-contract-smoke.v1` local API/runtime evidence.
- Connector acceptance checklist for each selected customer/provider connector.
- Redaction scan.
- Sync resume evidence.

Compose and Kubernetes impact:

- Connector can run through Compose and Kubernetes worker paths.

Security and migration notes:

- Connector-specific schema additions must be justified before baseline lock or added later as forward migrations.

## HAM-P27-02: First Customer Connector Acceptance

Phase: 27 Connectors And Sync Expansion.

Depends on: HAM-P27-01 and a concrete customer/provider requirement.

Goal: prove the connector framework with one real customer-demanded connector.

Scope details:

- Use a provider with clear API, auth, rate limits, deletion semantics, and test fixtures.

Tasks:

- Complete connector brief and threat model.
- Implement adapter and worker path.
- Add docs for admin setup, scopes, egress, imported data, deletion, and privacy impact.
- Run sync, update, delete/tombstone, retry, and redaction tests.

Definition of done:

- Connector sync works in Compose and Kubernetes.
- A failed sync resumes from the last safe cursor.
- Imported data respects workspace/source visibility.

Testing:

- Provider mocked integration tests.
- Compose worker smoke.
- Kubernetes worker render/live smoke where available.

Validation and evidence:

- Connector acceptance evidence.
- Admin setup docs tested by someone not on the implementation path.

Compose and Kubernetes impact:

- Docs include both `.env`/Compose and Secret/Helm configuration.

Security and migration notes:

- Do not generalize provider quirks into core service code.

## HAM-P28-01: Voice And Media Provider Expansion

Phase: 28 Voice, Media, And Native Capture.

Depends on: object-store artifact controls and provider secret posture.

Goal: add additional voice/media providers only when deployment demand justifies them.

Current status: backend/API lifecycle boundary, local provider-acceptance evidence, and production-provider evidence readback are implemented. Romeo already supports voice profile list/create/sync, OpenAI-compatible TTS/STT plus deterministic development provider tests, assistant-message speech generation, bounded transcription, authorized artifact readback through `GET /api/v1/voice-artifacts/{artifactId}`, artifact owner/admin deletion through `DELETE /api/v1/voice-artifacts/{artifactId}` and `client.voice.deleteArtifact(...)`, public responses with server-issued URLs and raw storage-key redaction, usage-event metadata redaction, and governance retention cleanup for stale generated voice artifacts with aggregate-only audit counts. `pnpm smoke:voice:provider-acceptance-contract` now proves disabled-provider fail-closed behavior, development-provider catalog dedupe, OpenAI-compatible sync/preview/transcription through the existing service boundary, artifact readback/deletion, usage redaction, provider failure redaction, and metadata-only evidence redaction. `pnpm evidence:voice-provider-live`, `VOICE_PROVIDER_LIVE_EVIDENCE_PATH`, `GET /api/v1/admin/voice/provider-live-posture`, and `client.admin.voiceProviderLivePosture()` provide sanitized mounted readback for reviewed live TTS/STT, artifact lifecycle, streaming-consent, provider-failure redaction, and log-redaction evidence, and `--require-voice-provider-live` can make that evidence a strict optional GA gate. Remaining Phase 28 work is additional deployment-demanded provider adapters only when a target requires them, executing the live evidence against selected production services, and native/mobile capture polish.

Scope details:

- Additional TTS/STT adapters, retention, usage accounting, artifact access, and optional streaming policy.

Tasks:

- Normalize voice, language, format, and provider limits.
- Add provider adapter tests.
- Define streaming consent and retention before enabling streaming.
- Verify artifact deletion and access control.
- Document Compose and Kubernetes settings.

Definition of done:

- At least one additional provider can be enabled without changing core voice service code.
- Voice artifacts have retention and access controls.
- Provider failures do not leak text or transcript content.

Testing:

- Provider adapter tests.
- Local `pnpm smoke:voice:provider-acceptance-contract` for provider boundary, artifact lifecycle, transcription usage, and redaction evidence.
- `pnpm evidence:voice-provider-live` plus admin posture readback for selected production provider evidence.
- Retention and artifact access tests.
- Permission denial and interruption tests.
- Usage/audit/log redaction tests.

Validation and evidence:

- `romeo.voice-provider-acceptance-contract-smoke.v1` local backend/API acceptance evidence.
- `romeo.voice-provider-live-evidence.v1` target metadata evidence for selected production TTS/STT services.
- Artifact deletion evidence.

Compose and Kubernetes impact:

- Provider credentials are injected through `.env` locally and Secrets/External Secrets in Kubernetes.
- Reviewed live evidence can be mounted through `VOICE_PROVIDER_LIVE_EVIDENCE_PATH` in Compose or Helm `evidenceMount`.

Security and migration notes:

- Streaming remains disabled until policy is accepted.

## HAM-P29-01: Notification Adapter Expansion And Retry Worker

Phase: 29 Collaboration, Notifications, And Customer Adapters.

Depends on: notification ledger and worker posture.

Goal: add required notification senders with non-blocking, retryable, redacted delivery.

Current status: implemented as backend/API lifecycle with local acceptance evidence and metadata-only live target evidence readback; selected target execution remains. Romeo now supports user-owned webhook, Resend-compatible email, SMTP email, Slack-compatible, Teams-compatible, PagerDuty Events API, and FCM mobile-push notification channels with non-blocking delivery ledgers, channel-type isolation before egress, and ID-only payloads that avoid comment/message bodies. User-owned product webhooks retry from stored allowlisted first-party event envelopes, while delivery readback and arbitrary test payload retries expose only redacted payload key summaries. Channel create/list readback now returns sanitized config summaries such as URL host, email domain, and secret-ref scheme only; raw webhook URLs, email addresses, secret-ref paths, and token/routing-key values remain internal delivery config. `NOTIFICATION_DELIVERY_DRIVER=configured` can route mixed channel types through one deployment, with `NOTIFICATION_EMAIL_DELIVERY_DRIVER=resend|smtp` selecting the email adapter; single-adapter driver modes remain available for constrained deployments. SMTP delivery uses the standard `email` channel type, Nodemailer-backed transport, secret-injected SMTP credentials, bounded connection/socket timeouts, and metadata-only ledger entries that omit SMTP usernames, passwords, provider response text, message IDs, and comment bodies. PagerDuty channels store only `routingKeyRef`, resolve routing keys through the configured secret resolver at send time, and omit routing keys, secret refs, provider responses, and comment bodies from delivery ledgers. FCM mobile-push channels store only a managed device-token `tokenRef`, resolve both the token and deployment service-account JSON at send time, generate bounded OAuth JWT access tokens in memory, and omit device tokens, service-account refs, private keys, access tokens, provider responses, and comment bodies from delivery ledgers. User channel config can set `enabledNotificationTypes` for per-channel category suppression. Org notification policy is implemented through `GET/PATCH /api/v1/admin/notification-policy`, TypeScript SDK `client.notifications.policy()/updatePolicy(...)`, generated Python SDK convenience methods, and CLI `romeo notifications policy/policy-update`; it stores delivery enablement, allowed channel types, allowed webhook/Slack/Teams hosts, allowed email domains, and suppressed notification types in `system_settings` without a migration. Policy-suppressed deliveries create disabled ledger rows with stable reason codes and no destination values. Transient delivery failures store metadata-only `nextAttemptAt` retry state, `POST /api/v1/notification-deliveries/retry-due` retries due failed deliveries through the active delivery adapter, exhausted attempts record metadata-only `deadLetter` details, and successful retries clear prior retry/error state. The retry surface is exposed through OpenAPI, the TypeScript SDK, generated Python SDK convenience method, `romeo notifications retry-due`, and the deployable `romeo workers notification-retry` loop. Compose includes a `notification-retry-worker` in the `workers` profile, Helm renders an optional `workers.notificationRetry` CronJob, and render/smoke scripts cover the worker name. `pnpm smoke:notifications:adapter-acceptance-contract` now provides local backend/API acceptance evidence for disabled fail-closed behavior, mixed configured adapter routing across webhook/SMTP/Slack/Teams/PagerDuty/FCM, secret resolution at send time, ID-only provider payloads without comment bodies, sanitized channel readback, org policy suppression with no egress, retry success cleanup, dead-letter exhaustion, channel-type isolation, and metadata-only evidence redaction. `pnpm evidence:notification-adapter-live`, `NOTIFICATION_ADAPTER_LIVE_EVIDENCE_PATH`, `GET /api/v1/admin/notifications/adapter-live-posture`, and `client.admin.notificationAdapterLivePosture()` provide sanitized mounted readback for reviewed live delivery, mixed channel routing, secret-ref resolution, egress policy, retry/dead-letter, channel-isolation, and log-redaction evidence, and `--require-notification-adapter-live` can make that evidence a strict optional GA gate. Hosted CI and the Phase 32 backend capability GA gate validate the resulting `romeo.notification-adapter-acceptance-contract-smoke.v1` evidence. Remaining HAM-P29-01 work is customer-specific webhook adapters only where a deployment requires them and executing the live evidence against selected notification vendors plus selected Kubernetes egress/log controls before claiming target notification readiness.

Scope details:

- Sender adapters, delivery retry command, dead-letter state, user preferences, admin allowlists, and sanitized delivery status.

Tasks:

- Add adapter only for concrete deployment needs.
- Add due-notification retry API, SDK, CLI, and deployable worker over the current delivery adapters.
- Enforce payload shape, timeout, size, and destination allowlist.
- Add user preference and admin disable controls; per-channel notification-type preferences and org notification policy are implemented.
- Add docs for Compose and Kubernetes configuration.

Definition of done:

- Delivery failures do not block core workflows.
- Disabled adapters cannot egress.
- Delivery ledger is useful without message bodies.

Testing:

- Adapter validation tests.
- Timeout, failure, retry, and dead-letter tests.
- Payload redaction tests.
- Preference and allowlist tests.
- `pnpm smoke:notifications:adapter-acceptance-contract`.

Validation and evidence:

- Notification adapter acceptance report.
- Redacted delivery ledger sample.
- Focused retry/dead-letter/redaction API, SDK, CLI, Compose, and Helm render evidence.
- Phase 32 backend capability GA evidence for `romeo.notification-adapter-acceptance-contract-smoke.v1`.

Compose and Kubernetes impact:

- Compose `workers` profile includes the notification retry worker; Helm can render `workers.notificationRetry` as a CronJob.

Security and migration notes:

- Notification bodies are not stored in delivery metadata by default.

## HAM-P30-01: Native Client Foundation

Phase: 30 Native Desktop And Mobile Clients.

Depends on: public API/SDK stability and release path.

Goal: build native shells without creating a second product contract.

Current status: implemented as a backend/API foundation with local contract evidence. Native clients can use the same `/api/v1` contract and SDK surface as the web app, including local/SSO session login where appropriate, refreshable device authorizations through `GET/POST /api/v1/device-authorizations`, public refresh-token rotation through `POST /api/v1/device-authorizations/refresh` without requiring an existing access token, owner/admin revocation through `/revoke`, server-side hashed refresh tokens, backing API-key rotation/revocation, scope-down enforcement, resumable file uploads, governed notification channel APIs including mobile-push token refs, and OpenAPI/TypeScript/Python SDK/CLI coverage. OpenAPI now uses typed native-client schemas for device create/list/refresh responses and notification channel create/list readback, with explicit one-time token semantics, refresh-token hash omission, mobile-push token-ref redaction, and sanitized config summaries. `pnpm smoke:native-client:api-contract` now proves the backend contract for device create/list/refresh/revoke, secure-mode refresh without an existing access token, scope escalation denial, scoped resumable upload composition/cleanup, mobile-push token-ref readback redaction, and metadata-only evidence without access tokens, refresh tokens, refresh hashes, upload URLs, object-store keys, mobile token refs, or uploaded content. Hosted CI and the Phase 32 backend capability GA gate validate `romeo.native-client-api-contract-smoke.v1`. Remaining HAM-P30-01 work is native shell implementation, platform secure-storage integration, offline cache invalidation policy, push-device registration UX, signed desktop/mobile build and update channels, and native security review/readback evidence.

Scope details:

- Framework decision, system-browser auth, secure storage, local cache policy, resumable upload, notifications, packaging, and update channel.

Tasks:

- Confirm target platforms.
- Write local token/storage threat model.
- Use shared API/SDK packages for business logic.
- Implement logout, revocation, refresh, offline cache, and upload retry.
- Define signed build and distribution process.

Definition of done:

- Native clients authenticate securely and use the public API.
- Tokens are stored in platform secure storage.
- Uploads can resume after interruption.
- Revoked sessions stop native access.

Testing:

- Platform auth tests.
- Secure storage and logout tests.
- Offline/cache invalidation tests.
- Upload interruption tests.
- Accessibility checks.
- `pnpm smoke:native-client:api-contract`.

Validation and evidence:

- Native client security review.
- Signed build/readback evidence.
- Phase 32 backend capability GA evidence for `romeo.native-client-api-contract-smoke.v1`.

Compose and Kubernetes impact:

- Native clients must work against Compose localhost and Kubernetes ingress with the same API contract.

Security and migration notes:

- Do not embed long-lived service keys in clients.

## HAM-P31-01: Browser Automation Worker

Phase: 31 Advanced Browser Automation Worker.

Depends on: Phase 25 worker boundary and Phase 26 approvals.

Goal: execute approved browser tasks only in an isolated out-of-process worker.

Current status: partially implemented as a backend/API worker foundation. Approved `browser_task` workflow steps now create metadata-only `workflow.browser_task.dispatch_request` jobs, move the workflow to `waiting_run`, and expose worker claim, lease renewal, screenshot/trace artifact upload registration, completion, failure, and stale-task expiry through `/api/v1/browser-automation-tasks/*`, OpenAPI, the TypeScript SDK, generated Python SDK convenience methods, and `romeo workflows browser-task-*` plus `browser-artifact-upload` commands. Registered artifacts are written through the object-store abstraction and read back only through server-issued `/api/v1/browser-automation-artifacts/{artifactId}` URLs with org/workspace authorization; normal workflow output omits object-store keys. Retention enforcement deletes stale registered browser artifacts from terminal jobs and removes their job metadata with aggregate counts only. `GET /api/v1/admin/browser-automation/posture` and `client.admin.browserAutomationPosture()` now expose metadata-only admin posture for worker enabled state, HTTPS runner-origin posture, NetworkPolicy flag, queue/stale/dead-letter counts, artifact registration counts, live runner/sandbox evidence status, warning codes, and redaction flags without returning runner URLs, evidence paths/bodies, raw task text, object-store keys, or secret values. `romeo workers browser-automation` is a thin external-runner bridge that requires an HTTPS runner URL, sends claimed tasks only to that runner, accepts bounded metadata-only results, and omits raw task text from worker stdout/stderr. `pnpm smoke:browser-automation:contract` now proves the backend contract locally: approved-task metadata redaction, stale running-job reclaim at attempt 2, external-runner completion, registered artifact readback, object-store retention cleanup, and retention readback/audit redaction. `pnpm evidence:browser-automation-live` now records reviewed `romeo.browser-automation-live-evidence.v1` for the mounted posture path and refuses `--status passed` unless live runner sandbox, CNI/NetworkPolicy denial, worker crash/retry, retention-worker execution, pod/worker log redaction, and redaction flags are consistent. Compose includes an opt-in `browser-automation` profile and app posture env flags; Helm can render an opt-in `workers.browserAutomation` CronJob, component-scoped NetworkPolicy, and read-only evidence mount for reviewed metadata evidence. Remaining HAM-P31-01 work is executing the reviewed runner/sandbox implementation, live NetworkPolicy/CNI denial proof, crash/retry evidence against the real runner process, retention-worker live execution evidence, and Kubernetes pod-log/egress evidence in the selected target environment.

Scope details:

- Worker threat model, allowed target classes, credential handling, file/download/upload policy, screenshot retention, artifact storage, egress allowlist, approval gates, Compose profile, and Kubernetes template.

Tasks:

- Complete browser worker threat model.
- Implement worker API claim/readback path.
- Launch isolated browser contexts per task in a reviewed runner implementation.
- Enforce URL validation, timeouts, navigation limits, artifact limits, and network denial.
- Store screenshots/traces in object storage through server-issued upload registration and keep retention cleanup wired through governance enforcement.
- Add optional deployment templates disabled by default.

Definition of done:

- Browser automation cannot execute before approval.
- Worker cannot reach blocked network ranges.
- Artifacts are access-controlled and expire according to policy.
- Readback metadata does not expose credentials or raw page secrets.

Testing:

- URL allowlist and private-network denial tests.
- Timeout, navigation, download, upload, and artifact-size tests.
- Approval rejected/expired/accepted tests.
- Worker crash and retry tests.
- Artifact retention/access tests.

Validation and evidence:

- Browser worker security report.
- Metadata-only API/SDK/CLI/Compose/Helm render evidence for the worker contract.
- Live runner sandbox and NetworkPolicy denial evidence.
- Artifact lifecycle evidence with object-store retention and access checks.

Compose and Kubernetes impact:

- Compose profile and Kubernetes worker template are opt-in and disabled by default.

Security and migration notes:

- Privileged browser sandbox exceptions require explicit risk acceptance.
