# Backlog Track: Client Experience And Automation

This file covers product-completion phases where Romeo reaches users through voice, notifications, native clients, and browser automation. These features are valuable, but they carry privacy, platform, and operations risk, so defaults should stay conservative.

## Phase 28: Voice, Media, And Native Capture

### Objective

Extend speech and media workflows beyond the initial OpenAI-compatible provider boundary while preserving user control, artifact retention, and deployment safety.

### Scope

- Additional TTS and STT provider adapters.
- Optional streaming speech after policy review.
- Native microphone and media capture refinements.
- Artifact storage, retention, accessibility, and usage accounting.

### Tasks

1. Provider expansion:
   - Add adapters only for requested providers.
   - Normalize voices, languages, formats, streaming support, and provider limits.
   - Keep provider keys in managed secrets.
   - Record usage and failures as sanitized metadata.

2. Streaming policy:
   - Define consent, retention, audit, transcript storage, and redaction rules before streaming is enabled.
   - Bound stream duration, chunk size, reconnect behavior, and provider egress.
   - Provide fallback to non-streaming mode.

3. Native capture:
   - Add desktop and mobile capture hooks through Phase 30 clients.
   - Handle permission prompts, device selection, interruption, offline queueing, and upload retry.
   - Avoid capturing without explicit user action.

4. Accessibility and UX:
   - Provide transcript review and correction where transcription is used.
   - Support keyboard operation and screen-reader labels for voice controls.
   - Expose clear status for recording, uploading, processing, and errors.

### Definition Of Done

- At least one additional provider can be enabled without changing core voice service code.
- Voice artifacts are stored with retention and access controls.
- Streaming, if enabled, has explicit consent and bounded retention.
- Native capture behavior is documented for each client.

### Testing

- Provider adapter unit and integration tests.
- Retention and artifact access tests.
- Permission denial and interruption tests.
- Upload retry tests.
- Redaction tests for usage, audit, and logs.

### Validation

- Voice provider failures do not leak prompt or transcript content into logs.
- Users can delete or expire voice artifacts according to policy.
- Native capture cannot start without user action.

## Phase 29: Collaboration, Notifications, And Customer Adapters

### Objective

Add collaboration and notification adapters required by target deployments while keeping delivery non-blocking, redacted, and auditable.

### Scope

- Additional notification senders only where customer-specific webhooks or provider-specific adapters are required. SMTP email is implemented through the standard email channel, Teams and PagerDuty delivery are implemented through `teams` and `pagerduty` notification channel types, and FCM mobile push is implemented through `mobile_push` channels with managed token refs.
- Notification preferences, admin allowlists, retry policy, and delivery ledger.
- Customer-specific collaboration policies where required.

### Tasks

1. Adapter pattern:
   - Keep each sender adapter small and typed.
   - Validate channel type before egress.
   - Use managed secret references for credentials.
   - Send ID-first payloads by default and avoid raw comment, prompt, or document bodies.
   - Enforce provider-specific timeout and size limits.

2. Delivery policy:
   - Define retryable and non-retryable failures.
   - Add dead-letter state for repeated failures.
   - Add per-channel rate limits.
   - Add admin allowlists for outbound domains or webhook destinations.
   - Provide user and admin visibility into sanitized delivery status.

3. Collaboration refinements:
   - Add mention, assignment, or escalation behavior only where the product workflow needs it.
   - Keep notifications non-blocking relative to core run/workflow completion.
   - Add policy hooks for regulated deployments that require notification suppression.

### Definition Of Done

- Each adapter has typed config, tests, docs, and redaction review.
- Notification delivery failures do not block core workflows.
- Delivery ledger is useful for support without storing sensitive message bodies.
- Admins can disable or restrict adapters by deployment.

### Testing

- Adapter validation tests.
- Timeout, provider failure, retry, and dead-letter tests.
- Payload redaction tests.
- User preference and admin allowlist tests.
- Webhook signature tests where applicable.

### Validation

- Notification payloads contain only approved IDs and metadata.
- Disabled adapters cannot egress.
- Failed deliveries are inspectable and retryable without exposing content.

## Phase 30: Native Desktop And Mobile Clients

### Objective

Provide native shells where required for desktop/mobile workflows while keeping the web app and API as the primary product contract.

Current status: backend/API foundation is implemented and locally evidenced. `pnpm smoke:native-client:api-contract` proves refreshable device authorization create/list/refresh/revoke, secure-mode refresh without an existing access token, scope-escalation denial, scoped backend-composed resumable upload with part cleanup, mobile-push token-ref readback redaction, and evidence redaction without access tokens, refresh tokens, refresh hashes, upload URLs, object-store keys, mobile token refs, or uploaded content. Native shell secure storage, push registration UX, signed app distribution, and target native security evidence remain open.

### Scope

- Shared API client usage.
- Native OAuth polish.
- Encrypted local storage.
- Notifications.
- Offline-aware local cache coordination.
- Resumable uploads.
- Desktop and mobile packaging.

### Tasks

1. Architecture:
   - Choose desktop and mobile frameworks only after target platforms are confirmed.
   - Keep business logic in shared API/SDK packages where possible.
   - Keep native code focused on shell, auth, secure storage, notifications, capture, upload, and OS integration.
   - Document threat model for local token storage and device compromise.

2. Authentication:
   - Use system browser OAuth or platform-native secure auth flow.
   - Store tokens in platform secure storage.
   - Support logout, remote revocation, token refresh, and session expiry.
   - Avoid embedding long-lived service keys in native clients.

3. Local cache and uploads:
   - Cache provider/model discovery, recent workspace metadata, draft prompts, and upload state where useful.
   - Encrypt sensitive local cache where platform support allows.
   - Use the implemented backend-composed resumable file upload API for large attachments and native capture.
   - Handle offline, slow network, cancellation, and retry.

4. Notifications:
   - Support push notifications only after provider and privacy review.
   - Allow users to control notification categories.
   - Avoid sensitive message text in push payloads by default.
   - Add device registration, revocation, and audit metadata.

5. Packaging and updates:
   - Define signed builds, update channels, crash reporting policy, and release readback.
   - Keep enterprise distribution paths documented.
   - Add mobile store and MDM considerations when needed.

### Definition Of Done

- Native clients authenticate securely, call the public API, and store tokens in secure storage.
- Local cache has a documented data classification and invalidation policy.
- Uploads can resume after interruption.
- Notifications, if enabled, use redacted payloads and revocable device registrations.
- Packaging and update process is documented and testable.

### Testing

- Auth flow tests on each target platform.
- Secure storage and logout tests.
- Offline/cache invalidation tests.
- Upload interruption and resume tests.
- Notification registration and revocation tests.
- `pnpm smoke:native-client:api-contract`.
- Accessibility checks for native UI.

### Validation

- A revoked session stops native API access.
- Lost network during upload does not corrupt server-side artifacts.
- Push notifications do not include sensitive content.

## Phase 31: Advanced Browser Automation Worker

### Objective

Implement live browser automation only behind the approved `browser_task` workflow contract and only as an isolated out-of-process worker.

Current status: backend/API worker contract is implemented. Approval queues metadata-only browser-task jobs, worker claim/renew/artifact-upload/complete/fail/expire APIs exist, CLI/SDK surfaces are wired, server-issued screenshot/trace artifact URLs are authorized through Romeo rather than direct object-store URLs, retention enforcement cleans stale terminal-job artifacts with aggregate counts only, and Compose/Helm opt-in worker deployment paths render. The live isolated runner and live network-denial/log evidence remain open.

### Scope

- Browser worker threat model.
- Isolated execution environment.
- Network and target allowlists.
- Artifact capture to object storage.
- Human approval gates.
- Compose and Kubernetes optional worker deployment.

### Tasks

1. Threat model:
   - Define allowed target classes, forbidden targets, credential handling, file download policy, upload policy, screenshot retention, and data exfiltration controls.
   - Keep local, private network, metadata-service, cluster-service, and unrestricted internet access denied by default.
   - Require explicit customer approval before enabling live automation.

2. Worker implementation:
   - Claim approved browser tasks through a worker API.
   - Launch isolated browser contexts per task.
   - Enforce timeout, navigation limit, download limit, upload limit, max screenshot count, and max artifact bytes.
   - Store screenshots and traces in object storage through server-issued upload registration and retention enforcement.
   - Return sanitized metadata only through readback.

3. Credentials and secrets:
   - Do not mount broad application secrets into browser workers.
   - Inject task-specific credentials only through approved managed references.
   - Avoid recording secrets in screenshots and traces where feasible; document limitations.
   - Add redaction or artifact access controls for sensitive sites.

4. Deployment:
   - Add optional Compose profile.
   - Add optional Kubernetes worker template with strict NetworkPolicy, resource limits, ephemeral storage limits, non-root runtime where possible, and no privileged mode unless a reviewed browser sandbox requires it.
   - Keep worker disabled by default.

### Definition Of Done

- Browser automation runs only for approved `browser_task` workflow steps.
- Worker is isolated, bounded, and disabled by default.
- Artifacts are stored with retention and access control.
- Readback metadata does not expose page secrets, raw screenshots, or credentials.
- Compose and Kubernetes deployment paths are documented.

### Testing

- URL validation and allowlist tests.
- Private network and metadata-service denial tests.
- Timeout, navigation, download, upload, and artifact-size tests.
- Approval required/rejected/expired tests.
- Worker crash and retry tests.
- Artifact retention and access-control tests.

### Validation

- A browser task cannot execute before approval.
- Worker cannot reach blocked network ranges.
- Artifacts can be reviewed by authorized users and expire according to policy.

## Sequencing

Voice and notification providers should be added only when a deployment requires them. Native client work should depend on the public API and SDKs rather than introducing separate product logic. Live browser automation should remain disabled until a deployment accepts its worker threat model and operating cost.
