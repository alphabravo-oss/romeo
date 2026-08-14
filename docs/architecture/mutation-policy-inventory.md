# Application mutation policy inventory

Status: EP-02-03 complete. The production inventory is at a literal zero for
unmanaged mutation observers, broad invalidations, and component cache writes.

## Enforced lifecycle

`serverMutationOptions` owns the fail-closed network gate, retry policy,
optimistic snapshot/update/rollback, success reconciliation, exact
invalidation, and an authentication/session generation guard. Logout advances
that generation before query cancellation and cache purge, so an in-flight
response from the prior principal cannot write into the next session.

Feature components now select a policy factory instead of embedding cache
semantics for:

- content-policy update and simulation;
- managed-model customization policy updates;
- interface theme preference persistence.
- API-key create, revoke, and partial bulk revoke;
- service-account create, key creation, disable, and partial bulk disable;
- current, remote, and all-other session revocation.
- local password, TOTP enrollment/confirmation/removal, and recovery-code
  generation;
- auth-provider settings, connection tests, and OIDC-user deprovisioning;
- resource grant/revoke actions with their caller-supplied exact resource key;
- workspace provider creation, connection verification/update, model
  synchronization/pull/delete/capabilities, and pricing updates;
- governance deletion preview/execution and retention update/enforcement.
- workspace chat update/archive, queued-turn cancellation, and default/last
  model preference persistence;
- workspace folder create/rename/item-add, chat tag/share/revoke, collaboration
  agent/chat/knowledge/folder sharing, and favorites.
- managed-model editor update/publish/rollback/delete/diff/export, access
  grant/revoke, and administration clone/import/export actions;
- workflow creation (blank and template), run start, approval, and resume.
- webhook create/disable/bulk-disable/test with signing-secret cache exclusion;
- evaluation suite creation/run and result rating.
- billing plan application, external-event sync, entitlement reconciliation,
  and lifecycle enforcement;
- workspace default-agent updates.
- managed-model creation, knowledge/tool binding updates, and exact test-run
  chat/usage convergence.
- prompt-template create/update/delete with exact refresh of every cached
  workspace catalog variant and marketplace projection;
- RAG policy/change-request review plus retrieval validation/replay/compare
  computations.
- OpenAPI tool import, connector/operation enablement, connector authentication
  probes, operation dry-runs/dispatch, and built-in tool execution/approval.
- data-connector creation/local import and delegated OAuth start/revocation,
  with ephemeral authorization/content mutation state.
- impersonation request approval/rejection and support-session revocation, with
  exact request/session convergence and one-time bearer-token cache exclusion.
- device-authorization creation/revocation, with ephemeral credential-bearing
  mutation state and public-metadata-only query reconciliation.
- user disable, role update, and local-password changes across every concrete
  cached directory page, with aggregate rollback and ephemeral password state.
- directory-sync preview/apply with ephemeral PII-bearing request state, no-op
  preview convergence, and exact user/group/member refresh after apply.
- group creation and membership administration, with exact catalog/member
  convergence and rollback for failed authorization-bearing removals.
- organization provisioning, metadata updates, suspension, and reactivation,
  with public-summary-only cache reconciliation and reversible lifecycle state.
- workspace archive/export lifecycle, with reversible archive state, exact
  workspace/audit convergence, and ephemeral export-document mutation state.
- governance export preview/execution, durable package creation/deletion, and
  package download, with exact audit/package convergence and ephemeral content.
- abuse-control suspension, entitlement, and kill-switch policy updates plus
  policy simulation, with reversible exact state and ephemeral evaluations.
- quota creation, update, usage reset, and deletion, with exact quota, usage
  alert, and cached audit convergence plus aggregate rollback.
- chat archive and legal-hold set/clear, with reversible cached-chat state and
  exact workspace lists, access-review, and cached-audit convergence.
- compliance, access-review, and access-review-report CSV generation, with
  ephemeral document state and exact cached-audit convergence.
- personal memory/note create, update, visibility/pin changes, and deletion,
  with ephemeral content state, aggregate page rollback, and exact variant
  convergence.
- knowledge-base/source create, ingest, extract, reindex, query, and delete;
- compute sandbox/image/artifact/operations previews and trust shred/break-glass/audit/SIEM previews, with ephemeral decision state and no cache writes;
- notifications, profile, interface, chat-experience, voice, and web writes;
- sidebar folder/item/favorite/import and live workspace chat-event convergence;
- chat creation/forking, run start/queue, message feedback/delete/retention,
  attachment image generation, and automatic-title convergence.

Credential creation reconciles only the non-secret summary into query cache;
one-time tokens remain component-local and tests assert that neither ordinary
success nor a response arriving after logout serializes the token into query
state. Revoking the current session uses the cookie-clearing current-session
endpoint, purges scoped drafts/cache, advances the mutation generation, and
returns the browser to login.

Workspace chat archive/delete and workspace archive handlers now invalidate
only their exact chat, workspace-chat-list, and bootstrap keys; the previous
root-wide invalidations are removed.

Tests cover optimistic success and exact convergence, version-conflict and
authorization rollback, zero network execution or paused queue while offline,
and suppression of late reconciliation after a session boundary.

## Closed ratchet and residual inventory

`scripts/check-app-mutation-policy-contracts.mjs` is wired into quality and CI.
It hard-fails root cache invalidation and invalid managed-factory calls. The
checked-in empty baseline rejects any unmanaged observer, component-owned
cache write, or non-exact invalidation. Its parser self-tests prove
inline/managed observer classification and root/broad/exact invalidation
detection.

Current baseline: **0 unmanaged observers, 0 non-exact invalidations, and 0
component-owned cache writes.** A future exceptional prefix invalidation
requires a documented policy and deliberate guard change; it cannot be
normalized into the baseline silently.

## Remaining migration batches

None for the production AST inventory. New server writes must enter through a
generated or feature-owned managed factory. Capability administration already
uses its generated managed factory. Transcript virtualization and the exact
live-row cache preserve their narrow client-only streaming semantics; neither
is a server mutation observer or invalidation exception.
