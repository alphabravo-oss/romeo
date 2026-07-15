# Backlog Track: Integration Runtime

This file covers product-completion phases where Romeo talks to external systems or executes external operations. The common requirements are scoped credentials, bounded egress, metadata-only operational records, and out-of-process execution for risky work.

## Phase 24: Delegated Connector OAuth

### Objective

Support connectors that require user-delegated OAuth without exposing refresh tokens to the app UI, audit logs, worker logs, or API responses.

Current status: the provider registry, GitHub PKCE authorization-start API, public callback completion, encrypted token persistence, sanitized connection list/revoke APIs, GitHub provider-side grant revocation, server-side callback replay rejection, GitHub connector credential selection through `delegatedOAuthConnectionId`, repository-backed refresh serialization, refresh-token rotation, revoked/reauthorization fail-closed behavior, and audit/redaction tests are implemented and covered by OpenAPI, TypeScript SDK, generated Python SDK, Compose, Helm, and focused API tests. UI polish remains open.

### Scope

- OAuth app registry.
- Authorization-code + PKCE connection flow.
- Token storage through managed secret references or encrypted server-side storage.
- Refresh, revocation, reauthorization, and connector credential selection.
- UI, API, SDK, CLI, audit, and worker integration.

### Tasks

1. OAuth provider registry:
   - Define provider metadata: authorization URL, token URL, scopes, redirect URL, PKCE support, refresh behavior, revocation URL, and allowed tenant restrictions.
   - Add admin-managed OAuth app configuration with client ID and managed client-secret reference where a secret is required.
   - Validate token and authorization hosts against connector allowlists.
   - Keep provider-specific quirks behind small adapter modules.

2. Connection flow:
   - Add start and callback endpoints with signed state, nonce, PKCE verifier, return path, workspace/org scope, and short expiry.
   - Store pending authorization state server-side or in signed HttpOnly cookies without raw secrets.
   - Bind completed connections to user, org, workspace, and connector type.
   - Record granted scopes, provider account ID, token expiry, and sanitized provider metadata.
   - Reject issuer, tenant, redirect, and state mismatches.

3. Token handling:
   - Store refresh tokens only through approved secret storage or encrypted server-side storage.
   - Store access tokens only transiently in worker memory.
   - Maintain repository-backed refresh locking to prevent token refresh storms across app instances.
   - Rotate stored token material after refresh when providers return new refresh tokens.
   - Maintain provider-side revocation and disconnect paths.
   - Ensure export, audit, jobs, and sync summaries never include token values.

4. Connector integration:
   - Let connectors select credential source: deployment secret, connector managed secret, delegated OAuth connection, or no auth.
   - Enforce owner/workspace visibility for delegated connections.
   - Add reauthorization-required state when refresh fails.
   - Add connector sync behavior that fails closed when required delegated credentials are missing, revoked, or expired without refresh.

5. UX and operations:
   - Add connection management UI with status, scopes, last used time, reauthorize, and revoke.
   - Add CLI commands for listing and revoking connections where appropriate.
   - Add admin visibility into provider configuration and aggregate connection health without exposing tokens.
   - Document redirect URL setup for Compose and Kubernetes ingress.

### Definition Of Done

- Delegated OAuth can connect, refresh, revoke, and reauthorize at least one reviewed provider.
- Token storage uses an approved managed-secret or encryption path.
- Connectors can use delegated credentials without receiving raw tokens through API responses.
- Audit and logs contain only sanitized connection metadata.
- Compose and Kubernetes docs cover redirect URL and secret configuration.

### Testing

- OAuth state, nonce, PKCE, expiry, redirect mismatch, tenant restriction, and replay tests.
- Token refresh success, refresh failure, rotation, revocation, and concurrent refresh tests.
- Connector sync tests using delegated credentials.
- Authorization tests for cross-user and cross-workspace connection access.
- Redaction tests for API responses, logs, audits, jobs, and sync summaries.

### Validation

- A revoked connection cannot be used by a connector worker.
- Expired tokens refresh once under concurrency.
- Failed refresh transitions the connection into reauthorization-required state.
- No token material appears in persisted metadata or logs.

## Phase 25: Out-Of-Process Tool Execution Workers

### Objective

Move real tool operation execution behind a worker boundary with explicit claim, execution, readback, retry, and dead-letter behavior.

### Scope

- Tool dispatch worker command.
- Durable metadata-only dispatch queue.
- External payload store or worker-local secure payload retrieval.
- Secret resolution in worker only.
- Network policy, egress allowlists, response validation, and sanitized readback.
- Compose and Kubernetes worker deployment path.

### Tasks

1. Dispatch queue contract:
   - Define queued, claimed, running, succeeded, failed, cancelled, expired, and dead-letter states.
   - Add claim lease, lease renewal, max attempts, timeout, and idempotency key.
   - Store only metadata in the app database: operation ID, connector ID, run ID, approval ID, state, attempt count, timestamps, and sanitized result metadata.
   - Keep raw request payloads outside general app persistence.

2. Worker command:
   - Add `romeo workers tool-dispatch` with `--once`, `--loop`, concurrency, max jobs, lease duration, and workspace/org filters.
   - Fetch jobs through an authenticated worker API.
   - Resolve raw payloads through a scoped worker path.
   - Resolve connector secrets inside the worker.
   - Execute bounded HTTP requests with allowlist, timeout, max bytes, method restrictions, redirect policy, and response validation.
   - Submit sanitized readback.

3. Worker security:
   - Use separate service account and API key scope.
   - Keep connector secret resolver access out of app pods when possible.
   - Apply Kubernetes NetworkPolicy to approved egress only.
   - Disable local network and metadata-service access unless explicitly allowed.
   - Redact headers, tokens, query secrets, request bodies, and response bodies.
   - Add denylist for private IPs, link-local metadata IPs, localhost, and cluster service ranges by default.

4. Failure and retry:
   - Distinguish validation failure, policy failure, provider failure, timeout, worker crash, and readback rejection.
   - Retry only safe failures according to policy.
   - Dead-letter jobs after max attempts or expiry.
   - Provide admin inspection of sanitized failure metadata.
   - Preserve idempotency for external operations where provider semantics allow it.

5. Deployment:
   - Add Compose worker profile.
   - Add Kubernetes Deployment or CronJob pattern depending on queue implementation.
   - Document required secrets, network policies, resource limits, and scaling behavior.
   - Add readiness checks for worker API credentials and secret resolver configuration.

### Definition Of Done

- Tool dispatch can run out-of-process with no raw payloads or secrets stored in general app metadata.
- Workers claim jobs atomically and cannot double-complete a terminal job.
- Failed jobs retry or dead-letter according to policy.
- Compose and Kubernetes worker paths are documented and tested.
- Default deployment leaves real operation execution disabled until the worker is configured.

### Testing

- Queue claim, lease, renewal, expiry, retry, cancellation, and terminal-state tests.
- Worker egress allowlist and private-network denial tests.
- Secret resolver tests in worker-only context.
- Response-size, timeout, redirect, invalid JSON, and schema-validation tests.
- Readback replay and terminal-state rejection tests.
- Compose worker smoke test.
- Kubernetes render tests for worker resources and NetworkPolicy.

### Validation

- App pods can enqueue metadata-only jobs without access to raw connector secrets.
- Worker logs and readbacks do not expose payloads, headers, tokens, or response bodies.
- Crashing a worker mid-job leaves the job reclaimable after lease expiry.
- Dead-letter inspection is useful without exposing sensitive data.

## Phase 26: Live Model-Driven Tool Orchestration

### Objective

Let model providers request tool calls during runs, route those calls through approval and worker boundaries, and resume generation with sanitized tool results.

Current status: partially implemented with bounded inline autonomous execution, durable approval wait/resume, metadata-only worker dispatch wait/resume, backend/API managed encrypted object-store payload handoff, and active-lease worker payload retrieval for OpenAI-compatible Chat Completions, OpenAI Responses-compatible, and Ollama tools. Runs can execute bound tools through `POST /api/v1/runs/{runId}/tools/{toolId}/execute`; the service derives the agent from the run, reuses the existing binding/approval/quota/audit/tool-call/run-event path, and accepts `modelToolCallId` for duplicate side-effect protection through a metadata-only `background_jobs` guard. TypeScript SDK support exists through `client.tool.executeForRun(...)`. Provider tool-call normalization now covers OpenAI-compatible chat `tool_calls`, Responses-style `function_call` items, and Ollama `message.tool_calls`. The OpenAI-compatible chat adapter performs real `/chat/completions` SSE streaming when the provider's managed `credentialRef` resolves, normalizes streamed text, usage, and same-turn batched tool-call chunks, serializes assistant/tool continuation messages, keeps deterministic dev echo only for uncredentialed local providers, and fails closed when a configured credential is unavailable. The OpenAI Responses-compatible adapter is now a first-class provider kind with `/responses` SSE streaming, `store:false`, typed function-call/function-call-output input-item continuation, streamed text and usage normalization, and fragmented function-call argument normalization. The Ollama adapter now uses `/api/chat` for JSON-line streaming text, token counters, tool definition injection, returned tool-call normalization, assistant/tool continuation serialization, optional bearer auth, and configured-credential fail-closed behavior. Provider APIs return credential posture only: `credentialConfigured` and `credentialRefScheme`. Romeo injects authorization-filtered registered tool schemas into tool-capable Chat Completions, Responses-compatible, and Ollama provider requests and forwards active provider credentials/fetch options across primary and fallback attempts. The runtime emits sanitized `tool.requested` events, executes single or batched non-approval built-in model-requested tools through the run-scoped `ToolService` path, resumes provider generation with bounded tool result content, stops fixed tool-call loops with `model_tool_call_limit_exceeded`, surfaces server-issued approval request IDs in metadata-only run events when approval-gated model tool calls stop, emits `run.waiting_tool_dispatch` for model-requested imported operations, stores raw model-provided operation payloads only as encrypted object-store envelopes when `TOOL_DISPATCH_PAYLOAD_STORE_DRIVER=object-store` is enabled, lets the active worker lease retrieve those raw payloads through the explicit payload API, resumes provider generation after sanitized worker completion/failure readback, and cancels linked queued/running dispatch jobs when the run is cancelled. Release-candidate eval evidence now includes aggregate expected-tool-call and expected-tool-outcome pass/fail counts with redaction guarantees for raw tool names, arguments, output keys, error codes, and result bodies. Future provider-specific continuation beyond OpenAI-compatible, Responses-compatible, and Ollama, live deployment evidence, target eval evidence, and UI polish remain open.

### Scope

- Provider tool-call abstraction.
- Runtime state machine for tool requests, approvals, dispatch jobs, worker readback, and model continuation.
- UI for approval and run progress.
- SDK and CLI support.
- Evaluation support for expected tool calls, expected tool outcomes, and metadata-only release-candidate aggregate evidence.

### Tasks

1. Provider abstraction:
   - Normalize tool-call requests across providers.
   - Represent function name, arguments, provider call ID, model run ID, and safety classification.
   - Validate arguments against registered tool schemas before dispatch.
   - Support providers that require tool results in different continuation formats.

2. Runtime state:
   - Add run states for waiting_for_tool_approval, waiting_for_tool_execution, tool_failed, continuing, completed, and cancelled.
   - Persist tool-call events with schema validation metadata, approval state, dispatch job ID, sanitized result metadata, and continuation status.
   - Ensure run resume is idempotent.
   - Preserve cancellation semantics across pending approvals and worker jobs.

3. Approval flow:
   - Reuse existing approval gates where possible.
   - Require explicit approval for risky tools, external writes, browser tasks, and configured connector classes.
   - Show users concise tool name, target connector, risk level, argument keys, and expected effect.
   - Do not show hidden secrets, raw tokens, or redacted arguments.

4. Execution and continuation:
   - Dispatch approved calls through Phase 25 worker boundary.
   - Convert sanitized tool result metadata into provider-specific continuation input.
   - Keep large result bodies in object storage only when a product requirement allows them.
   - Add retry/cancel behavior that does not duplicate external side effects.

5. Evaluation and observability:
   - Add eval cases for expected tool-call plans.
   - Track approval latency, execution latency, failure class, provider continuation errors, and user cancellation.
   - Add audit records for tool-call request, approval, dispatch, readback, and continuation.

### Definition Of Done

- A model can request a tool call, wait for approval if required, execute out-of-process, and resume generation.
- Unsafe or invalid tool arguments fail closed before dispatch.
- Users can inspect and approve or reject pending tool calls.
- Tool-call events, audits, usage, and logs are redacted.
- Evaluations can assert expected tool-call behavior.

### Testing

- Provider normalization tests for each supported provider.
- Schema-validation failure tests.
- Approval required, approval rejected, approval expired, and approval accepted tests.
- Worker success, worker failure, timeout, cancellation, and duplicate readback tests.
- Provider continuation tests.
- UI tests for pending approval and run continuation states.
- Audit and redaction tests.

### Validation

- Live tool orchestration is disabled until worker execution is configured.
- No model-provided arguments bypass schema validation.
- External side effects are not repeated after retries or resume.
- Audit timeline reconstructs the tool call without exposing sensitive payloads.

## Phase 27: Connectors And Sync Expansion

### Objective

Add customer-demanded connectors using a repeatable, secure adapter pattern instead of one-off integration code.

### Scope

- Concrete adapters for customer-required systems.
- Incremental sync, delete/update handling, cursor storage, rate limits, and retry.
- Delegated OAuth or managed secret credentials.
- Connector-specific tests and documentation.

### Tasks

1. Connector intake:
   - Require a connector brief covering API surface, auth, data classes, rate limits, egress domains, webhook availability, deletion semantics, and tenant boundaries.
   - Threat-model each connector before implementation.
   - Decide whether data imports into knowledge, tools, workflows, notifications, or another product surface.

2. Adapter structure:
   - Keep each connector in a small adapter module with typed config, auth source, fetch/list methods, cursor handling, normalization, and tests.
   - Reuse shared HTTP, retry, allowlist, redaction, and secret-resolution helpers.
   - Keep provider-specific quirks out of service-layer code.

3. Sync behavior:
   - Support incremental cursors and full resync.
   - Record source update, delete, permission, and tombstone behavior.
   - Handle rate limits and backoff.
   - Store sync summaries as sanitized metadata.
   - Keep raw external documents only in the intended knowledge/artifact storage with retention rules.

4. Documentation:
   - Document required scopes, admin setup, egress hosts, rate-limit expectations, and data imported.
   - Document Compose and Kubernetes settings.
   - Document deletion behavior and privacy impact.

### Definition Of Done

- Each connector has a threat model, typed config, tests, docs, and redaction review.
- Sync can resume after worker crash without duplicate imports.
- Deleted or inaccessible source data is handled according to documented policy.
- Connector credentials are never exposed through API responses, logs, audits, or sync summaries.

### Testing

- Adapter unit tests with recorded or mocked provider responses.
- Sync cursor and idempotency tests.
- Rate-limit and retry tests.
- Permission and deletion behavior tests.
- Egress allowlist tests.
- Redaction tests.

### Validation

- Connector can run in Compose and Kubernetes worker paths.
- A failed sync can resume from the last safe cursor.
- Imported data respects workspace and source visibility.

## Sequencing

Delegated OAuth should precede customer connectors that need user consent. Out-of-process tool execution should precede live model-driven tool orchestration. Runtime connector work should not lock new data models until the durable Postgres baseline is accepted.
