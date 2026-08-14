# Run-event streaming architecture

**Status:** accepted for EP-01  
**Last reviewed:** 2026-08-14

## Decision

Romeo uses REST for run commands and resumable Server-Sent Events for ordered server-to-browser run output. PostgreSQL is the only durable event system of record. A notification transport carries only `{runId, sequence}` wakeups and never event content.

Production uses Valkey Pub/Sub for cross-process wakeups and PostgreSQL cursor replay for durability. Development and tests use the same transport contract with an in-memory implementation. Valkey Streams are not used for run durability: retaining a second replay log would create two sources of truth and two retention systems. If a notification is lost or Valkey is unavailable, the subscriber recovers through a bounded indexed PostgreSQL cursor query.

## Commit and delivery order

1. Allocate a sequence atomically on the run row.
2. Persist the event inside the caller's transaction.
3. Commit all related run, transcript, usage, audit, and outbox changes.
4. Publish a metadata-only wakeup after commit.
5. Read `run_events` after the subscriber's last fully applied sequence.

Transactional callers use `RunEventSequencer.persist()` and call `notify()` only after the outer transaction resolves. Non-transactional callers use `append()`, which performs both operations in order. Notification failure never rolls back committed work.

The replay loop subscribes before its first cursor read. This is equivalent to the conventional read-subscribe-read loop without its first redundant query: anything committed before subscription is returned by the cursor read, and anything committed after subscription produces a wakeup. A bounded one-second cursor poll remains as degraded recovery.

## Protocol

- Endpoint: `GET /api/v1/runs/{runId}/events`
- Resume: `Last-Event-ID`, with the legacy `after` query retained. Conflicting cursors are rejected.
- Envelope version: `schemaVersion: 1`
- Required envelope fields: `id`, `runId`, `sequence`, `type`, `createdAt`, `data`
- Optional multiplex fields: `legId`, `channel`
- Heartbeat: non-durable SSE comment every ten seconds
- Retry hint: one second; the client applies bounded exponential backoff with jitter
- Proxy posture: `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`, `Connection: keep-alive`; ingress idle timeouts must exceed the heartbeat interval and response buffering/compression must not coalesce frames

The server caps replay page size, individual event size, stream buffered bytes, and backpressure duration. A slow client is disconnected without affecting provider execution or the durable event log.

## Browser and cross-tab policy

Each authenticated browser tab owns its own run stream. Romeo deliberately does not use BroadcastChannel leader election at this stage: independent streams have simpler account/logout isolation, do not make one tab a data broker for another, and recover independently after suspension or process loss. Capacity tests therefore size the server for active tabs rather than active users.

The cursor advances only after an event is fully applied to the registry and query cache. The client deduplicates by sequence and event ID. Provider text, reasoning summaries, tool state, and terminal events are applied through the same ordered reducer. A suspended run is a stable state, not a failed connection.

## Client rendering and cache ownership

`["messages", chatId]` owns the ordered transcript tree and remains stable while an answer grows. The optimistic assistant node is inserted there once, while its mutable payload is frame-batched into `["streamingMessage", chatId, messageId]`. Only that row observes the narrow entry. This prevents a delta flush from rebuilding/sorting `chatPath` and `messageVariants`, rescanning artifacts, or mapping every row. A shared canonical buffer survives navigation and query eviction; refresh reconciliation reasserts the optimistic topology node; cancellation, suspension, failure, and completion flush pending text and commit the complete row to the transcript before the run is published idle. The narrow entry is removed after persisted-message reconciliation and is also configured with a 30-second observer GC bound.

Streaming Markdown is append-segmented at conservative blank-delimited top-level
boundaries. Completed segments keep stable React identity and do not reparse on
later deltas; only the incomplete tail changes. Fences, display math, loose
lists, task lists, quotes, and tables remain indivisible, while reference-link
or raw-HTML constructs fall back to one document because they can affect prior
blocks. Terminal reconciliation deliberately returns to the canonical
monolithic renderer. Syntax highlighting and math modules load dynamically only
for mounted segments whose syntax needs them; Mermaid remains strict-mode and
loads only for a requested preview. Segment-relative AST offsets are rebased so
artifact identities remain message-relative.

This is not transcript windowing. The client still fetches and renders the full
active branch and rebuilds the tree on structural changes. EP-04-02/03 must add
branch-aware cursor paging and virtualization, EP-04-04/05 must add incremental
topology indexes, and EP-04-14 must suspend offscreen media/diagram work. The
segmentation benchmark measures parser/render invocations and bytes, not browser
layout, paint, or long-task duration.

## Relationship to other event streams

The run stream is the reusable pattern for durable, ordered, cursor-addressable output. Future compare legs, compute jobs, long-running exports, and workflow execution events must use the same PostgreSQL-log plus metadata-wakeup design unless an architecture decision proves different ordering, retention, or tenancy needs.

Workspace chat-change events are deliberately different: they are bounded invalidation hints whose consumer immediately reconciles authoritative chat state. Their Valkey/in-memory history may expire without losing chat data, so copying every hint into PostgreSQL would add durable write volume without adding correctness. Channel and OpenWebUI live events likewise keep their existing persisted-message plus reconciliation model until their contracts require durable per-event replay. All SSE routes must still converge on the shared encoder limits, heartbeat, cancellation, sanitized-error, and observability conventions; transport persistence is selected by the event's recovery requirement rather than by UI similarity.

## Retention

Run-event retention is an organization policy distinct from chat, file, and audit retention. Only intermediate events belonging to terminal runs older than the configured period are compacted. The highest-sequence event is retained with the run so a completed stream still has a durable terminal tail. Running, queued, and suspended runs are never compacted. Active chat legal holds prevent compaction.

Enforcement deletes at most 10,000 event rows per invocation, reports whether the bound was reached, and can converge over repeated scheduled runs. The terminal run record and transcript are committed before an event becomes eligible.

## Provider-safe reasoning summaries

`reasoning.summary.delta` and `reasoning.summary.completed` are additive,
provider-neutral events and are never assistant answer content. A delta is
public only when it is explicitly classified `provider_safe_summary` and
marked as content-policy governed. The runtime buffers the complete bounded
summary for one provider attempt, then core applies DLP/content policy to the
assembled text before either durable write or browser release. This prevents a
sensitive value split across native chunks from bypassing policy.

A normally completed attempt emits governed deltas followed by a `completed`
metadata event. Cancellation, timeout, provider failure, retry, and fallback
discard the buffered text and emit only `hidden`/`discarded` metadata. Tool
continuations close the successful provider attempt before starting a new
attempt, so summaries never merge across attempts. Legacy `message.reasoning`
and malformed or unclassified summary rows are reduced to a bounded
metadata-only hidden marker.

Replay repeats the assembled policy check before SSE encoding, including for a
malicious persisted row that forges the governed marker. Summary events inherit
run-event retention, legal hold, deletion, and tenant purge. Context preview,
portable export, external share, webhook, and audit exclude summary text by
default; Romeo has no implicit external-export exception for this data.

## Security

- The canonical run authorization check occurs before replay.
- Open streams rebuild their principal from current user/service-account,
  credential, membership, workspace, and grant state on a bounded cadence.
  Revoked/expired sessions, revoked API keys, disabled principals, and removed
  access terminate the transport with a detail-free stable error; checks are
  not performed per event or token.
- A notification never grants access and carries no content, tenant, prompt, or error text.
- Reconnect reauthenticates and reauthorizes the run.
- Public event errors are stable and sanitized; raw provider errors are excluded.
- Runtime shutdown stops and drains workers, then closes run and chat notification clients before the database pool closes.

## Failure behavior

- Notification publish failure: committed events replay by cursor.
- Subscriber creation failure: bounded cursor polling.
- Browser disconnect: request abort removes the listener and heartbeat/backpressure timers, propagates through the repository cursor contract, and calls postgres.js protocol-level query cancellation for an in-flight PostgreSQL read.
- Process or replica failure: reconnect to any replica resumes from PostgreSQL.
- Duplicate notice or delivery: client and cursor logic deduplicate.
- Slow consumer: bounded retryable disconnect; no provider cancellation or database transaction is held.

## Required release evidence

- In-memory and live PostgreSQL atomic sequence/concurrency tests
- Transaction rollback test proving no pre-commit notification
- 10,000-event indexed tail replay and query-plan evidence
- Multi-replica reconnect/process-restart acceptance
- Valkey interruption and degraded cursor recovery test
- Chromium, Firefox, and WebKit proxy/idle-heartbeat acceptance
- Target-capacity concurrent stream load evidence with memory, query rate, reconnect recovery, notifier-to-browser p99, and slow-client behavior

Items in the last section are release evidence requirements, not implied by the existence of this decision record.

## Implemented evidence

- `packages/core/src/services/run-events.test.ts` proves atomic multi-writer sequences, after-commit notification, rollback isolation, bounded cursor reads, notifier wakeup/fallback, abort cleanup, and signal propagation during an in-flight cursor read.
- `packages/core/src/run-event-route.test.ts` proves cursor compatibility, conflict rejection, SSE headers/versioning, and immediate terminal-tail closure.
- `packages/db/src/romeo-repository.test.ts` runs the same sequence, cursor, compaction, and legal-hold behavior against in-memory and live PostgreSQL repositories.
- `packages/db/src/cancellable-query.test.ts` proves preflight abort, cancellation races, preserved abort reasons, and—when the conformance database is configured—server-side cancellation of `pg_sleep` followed by a healthy pool query.
- `pnpm evidence:run-sse:live` creates a fresh migrated PostgreSQL database and records metadata-only `romeo.run-sse-live-acceptance.v1` evidence. Its default profile proves an indexed 10,000-event tail, restart replay, 1,000 concurrent subscribers, 33 ordered events per subscriber, no duplicate/lost sequence, bounded cursor pages, bounded heap growth, and zero retained subscriptions.
- The operational exporter publishes process-scoped run-SSE connection, replay, cursor, notification-lag, buffer, slow-consumer, heartbeat-failure, and terminal-close metrics with alert rules and no content identifiers.
- `packages/core/src/services/run-stream-authorization.test.ts` proves live
  session/API-key revocation, grant removal, detail-free termination, and
  cadence-based (not per-event) authorization checks.
- `pnpm test:browser:run-sse` exercises fetch/ReadableStream SSE through a
  loopback proxy across Chromium, Firefox, and WebKit, including split chunks,
  gzip, deliberate buffering, heartbeat comments, proxy idle disconnect, and
  `Last-Event-ID` resume. Its evidence is metadata-only.
- `apps/app/src/lib/run-registry.test.ts` exercises 750 historical page rows
  with 2,000 ordered deltas. Before settlement it proves stable page identity,
  zero historical-page or optimistic-topology writes/observer notifications,
  one active-row write/observer notification, and two registry notifications,
  plus canonical-buffer recovery after query eviction; settlement proves one
  overlay commit containing every token while all 750 page-row identities stay
  stable.
  The same suite proves a pending frame is flushed exactly once on cancel,
  reconnect replay is deduplicated without token loss, failure is committed
  inline once, navigation does not stop consumption, and each settled scoped
  cache entry is removed exactly once.

Live deployment-ingress evidence remains separate because a loopback HTTP/1.1
test cannot prove a customer's CDN/ingress buffering and compression, HTTP/2
handling, timeout, draining, or load-balancer configuration.
