# Secure file lifecycle

Status: implemented. Upload requests validate and durably enqueue content; the
supervised tenant scheduler owns all scanning, OCR, extraction, retry, and
dead-letter transitions outside the HTTP request.

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
                         \-> failed -> quarantined (scheduled or explicit retry)
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
`available` rows continue to read and execute. Inline upload persistence and
direct/resumable completion validate declared size, digest, media signature,
authorized ownership, and object-store acknowledgement, then atomically persist
`quarantined`. Scanner, extractor, and OCR adapters are not called before the
HTTP response.

Memory and PostgreSQL repositories expose the same claim, stage-advance, renew,
and finish operations. PostgreSQL claims use `FOR UPDATE SKIP LOCKED`; all stage
and terminal writes compare the current lease owner, opaque token, unexpired
lease, and lifecycle version. A crashed worker can be taken over after expiry,
while a stale worker cannot renew, advance, or finish the record.

`lifecycleAttempts` has one source per processing attempt:

- upload completion enters quarantine with zero attempts;
- every exclusive leased claim increments exactly once;
- failure persistence does not increment it again;
- explicit retry only requeues and preserves the count.

Retries use a bounded exponential schedule starting at 30 seconds and capped at
15 minutes. Five failed claims exhaust the policy, clear the retry timestamp,
and persist a sanitized `fileLifecycleDeadLetter` record. Retry API calls and
extraction retries only requeue work; neither reads the object nor executes a
scanner/extractor in the request.

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

The worker derives an absolute per-stage deadline below the lease and combines
it with the supervisor drain signal. The combined `AbortSignal` reaches bounded
object reads, ClamAV sockets, OCR child processes, PDF child processes, and
binary extractors. A timeout aborts cooperative work before the lease is
released; completion remains fenced even after crash/reclaim.

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

Retention enforcement includes legacy available, ready, attached, and exhausted
failed objects, but does not delete retained records. It also
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

The file library uses a governed TanStack mutation factory, exact cached-page
invalidation, and a two-second recovery poll only while a page contains pending
files. It exposes localized English, Spanish, and French lifecycle labels, live
background progress, finite failure code, retry eligibility/exhaustion,
disabled attachment affordances before readiness, and retry/cancel-delete
controls. Errors use canonical privacy-safe user copy. The catalog is keyboard
operable and uses status semantics that remain meaningful without color.

The internal all-tenant coordinator owns `file_lifecycle` at a one-second
interval with only `files:read` and `files:write`, a deterministic tenant job,
lease heartbeat/fencing, bounded fair tenant selection, replica suppression,
and supervisor drain. No organization API key or global-admin worker credential
is involved. Readiness requires a fresh `scheduled_file_lifecycle` snapshot.
The operational job summary adds a bounded aggregate `file.lifecycle` queue
projection without file or tenant identifiers; Prometheus alerts on oldest queue
age and any current dead letter.

## Validation evidence

Automated coverage includes:

- central transition/version validation and retained-state denial;
- required-scanner unavailable, automatic and explicit retry, exponential
  backoff, dead-letter exhaustion, and single-source attempt count;
- malicious upload object deletion and content-free tombstone persistence;
- declared-size and configured upload-mode object-read bounds;
- exclusive claim, renewal, stage advance, stale finish rejection, crash expiry,
  takeover, and memory/PostgreSQL parity;
- legacy available and new ready/attached/retained retention eligibility, with
  nonready and retained exclusion;
- tenant/workspace/resource authorization and action-time run-context readiness;
- direct, resumable, and inline accepted/quarantined completion, object
  durability, idempotency, and no-inline-scanner behavior;
- supervisor abort propagation through object read, malware scan, OCR, and
  extraction adapters;
- operational queue aggregate/alerts, scheduler ownership, drain, and UI
  polling/progress/exhaustion behavior;
- migration checksum/baseline/evolution-policy checks;
- generated contract parsing, localized UI state, mutation policy, query-key,
  type, architecture, build, and bundle gates.

The repository can run the PostgreSQL parity suite when its live database test
environment is configured. The in-memory conformance suite runs unconditionally.

Live target evidence remains environment-gated: PostgreSQL `SKIP LOCKED`/RLS
contention with pool size one, a real ClamAV and OCR cancellation drill, a
Compose crash-and-reclaim run, Prometheus rule firing/clearance, and an
upload-to-ready browser acceptance against the deployed target.
