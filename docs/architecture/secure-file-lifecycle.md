# Secure file lifecycle

Status: implemented foundation with an explicit completion prerequisite. Roadmap
item EP-07-03 remains open because production attachment and retention writers do
not yet transition file records to `attached` and `retained`.

## Security objective

File bytes are untrusted until a governed lifecycle has made them usable. A file
may be returned in an authorized file catalog so a user can observe or recover a
failed upload, but message attachment, provider dispatch, tool input, content
read, and retrieval context must reject it unless it is in a usable state and the
caller still has tenant, workspace, and resource-grant access.

The compatibility state `available` remains usable during the additive rollout.
New writes use the versioned lifecycle and reach `ready`. The other usable states
are `attached` and `retained`; `retained` is terminal except for deletion by a
separate, authorized legal-hold release workflow that does not yet exist.

## State machine

The central validator in `file-lifecycle.ts` owns legal state transitions and
monotonic version checks. Current processing follows:

```text
uploading -> quarantined -> scanning -> extracting/transcoding -> ready
                         \-> failed -> quarantined (explicit retry)
                         \-> deleted (malware rejection)
ready -> attached | retained | failed | deleted
attached -> ready | retained | failed | deleted
retained -> deleted
```

`deleted` is a content-free tombstone. Deletion clears file name, hash, object
key, metadata previews, lifecycle failure/retry/lease fields, and attachment or
retention timestamps while retaining the stable record identifier needed for
referential and audit continuity.

The matrix does not by itself authorize a transition. All request paths first
enforce the caller's scope, organization, workspace access, resource grant, and
legal-hold rules. A lower lifecycle state cannot bypass an upper retention deny.

## Persistence and rollout

Migration `0027_secure_file_lifecycle.sql` is additive. It introduces bounded
status/version/attempt fields, safe failure and next-attempt fields, exclusive
lease owner/token/expiry fields, attachment/retention timestamps, checks, and a
claim index. It deliberately contains no unbounded data rewrite. Legacy
`available` rows continue to read and execute while new uploads write lifecycle
version zero and transition to `ready`.

Memory and PostgreSQL repositories expose the same claim, stage-advance, renew,
and finish operations. PostgreSQL claims use `FOR UPDATE SKIP LOCKED`; all stage
and terminal writes compare the current lease owner, opaque token, unexpired
lease, and lifecycle version. A crashed worker can be taken over after expiry,
while a stale worker cannot renew, advance, or finish the record.

`lifecycleAttempts` has one source per processing attempt:

- synchronous initial processing increments when it enters quarantine;
- a leased retry increments during claim;
- failure persistence does not increment it again;
- explicit retry only requeues and preserves the count.

The retry ceiling is 100. Retry API calls are idempotently rejected outside the
failed state and never execute scanner or extraction work inline.

## Object and processing bounds

Worker object reads pass an explicit `maxBytes` equal to the smaller of the
record's declared size and its configured upload-mode limit. Inline, direct, and
resumable records therefore share the same advertised `FileServiceLimits`; there
is no hidden worker ceiling that invalidates otherwise accepted resumable files.
An object-store size-limit error becomes the finite public-safe lifecycle code
`file_size_mismatch`. Scanner, extractor, and OCR/provider/internal codes are
mapped through a finite allowlist and arbitrary upstream identifiers are never
persisted or returned.

Required malware scanning fails closed when the scanner is missing or
unavailable. Malware rejection deletes every composed/part object and persists a
content-free tombstone. Scanner and extractor work are bounded below the lease,
with a renewal and version recheck before each expensive stage. A stale lease or
duplicate callback cannot commit a terminal state.

Data-export object reads also use declared, per-request, and global bounds before
materializing bytes. Exported file metadata intentionally omits object keys,
lease owners/tokens/expiry, internal retry scheduling, and provider/scanner
bodies.

## Runtime enforcement

The canonical ready predicate accepts legacy `available` and new `ready`,
`attached`, or `retained` rows. It is enforced at the last responsible moment in
file content reads, extraction retry, run context/provider projection, and
workspace-content access after tenant/workspace/resource authorization. This
ordering avoids disclosing cross-tenant file existence or lifecycle state.

Retention enforcement includes legacy available plus new ready and attached
objects, excludes nonready records, and does not delete retained records. It also
rechecks the deletion plan immediately before deletion so a new legal hold wins a
race with a scheduled retention job. Tenant purge and ordinary deletion reuse
existing repository/object cleanup; the additive lifecycle columns cascade with
the file row. Data export includes authorized file metadata and optionally
bounded bytes without exposing worker internals.

## API and UI

Public file responses expose schema version, state, monotonic version, attempt
count, retryability, finite failure code, retry time, and safe attachment or
retention timestamps. `leaseExpiresAt` remains nullable in the compatibility
shape but is always returned as `null`; operational lease timing is internal.

The retry route is a generated-client-safe `POST` mutation. It records a
privacy-safe `file.lifecycle.retry` audit event containing only attempt count,
finite failure code, workspace identifier, and standard telemetry metadata.

The file library uses a governed TanStack mutation factory and exact cached-page
invalidation. It exposes localized English, Spanish, and French lifecycle
labels, live status text, disabled attachment affordances before readiness, and
retry/cancel-delete controls. Errors use canonical privacy-safe user copy. The
catalog is keyboard operable and uses status semantics that remain meaningful
without color.

## Validation evidence

Automated coverage includes:

- central transition/version validation and retained-state denial;
- required-scanner unavailable, explicit retry, and single-source attempt count;
- malicious upload object deletion and content-free tombstone persistence;
- declared-size and configured upload-mode object-read bounds;
- exclusive claim, renewal, stage advance, stale finish rejection, crash expiry,
  takeover, and memory/PostgreSQL parity;
- legacy available and new ready/attached/retained retention eligibility, with
  nonready and retained exclusion;
- tenant/workspace/resource authorization and action-time run-context readiness;
- direct, resumable, and inline completion/idempotency behavior;
- migration checksum/baseline/evolution-policy checks;
- generated contract parsing, localized UI state, mutation policy, query-key,
  type, architecture, build, and bundle gates.

The repository can run the PostgreSQL parity suite when its live database test
environment is configured. The in-memory conformance suite runs unconditionally.

## Open completion prerequisite

No production path currently owns the reference-counted transition from `ready`
to `attached`, or the policy/legal-hold transition to `retained`. Run creation
still copies reusable file metadata into legacy message attachment objects rather
than atomically linking the file record. Consequently detach, message deletion,
hold release, and “last reference removed” behavior cannot yet be proven.

EP-07-03 must remain open until a single transactional owner implements and tests:

1. atomic message-part/file reference creation and `ready -> attached`;
2. idempotent detach/message-delete reference removal without deleting a file
   still referenced elsewhere;
3. policy/legal-hold acquisition as `ready|attached -> retained`;
4. authorized hold release semantics that cannot weaken an active hold;
5. export, tenant purge, retention, and concurrent attach/delete races for those
   reachable states in both memory and PostgreSQL.

These requirements naturally meet EP-07-07 output-part persistence and EP-07-10
action-time access work, but they are not considered complete merely because the
states and columns exist.
