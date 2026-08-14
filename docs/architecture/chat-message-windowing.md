# Chat message windowing semantics

`GET /api/v1/chats/{chatId}/messages/page` pages upward through one fixed branch
and is the app's sole historical transcript source. The legacy full-list route
remains API-compatible for export/integrations, but the chat UI never mounts it.
The first version deliberately supports only `direction=older`; newer paging,
search jumps, and arbitrary deep links require a separate contract.

## Branch snapshot and ordering

- A chat is a message graph. `parentId` is the graph edge and
  `activeLeafMessageId` selects the rendered branch.
- The first request snapshots the current active leaf and walks that message's
  parent pointers. PostgreSQL uses a recursive CTE bounded to `limit + 1`
  nodes. Sibling variants can never enter the page.
- Each page is returned in root-to-leaf order even though the database walks
  leaf-to-root. Clients merge by message ID and retain `parentId`; they must not
  infer parentage from array adjacency.
- The response's `branchLeafMessageId` is the fixed snapshot.
  `currentActiveLeafMessageId` is the current chat value and
  `activeBranchChanged` reports a concurrent append or branch switch. Paging
  continues against the snapshot and never silently changes branches.
- Chats written before parent pointers/active leaves use a legacy linear mode
  with a `(createdAt,id)` keyset. Equal timestamps are deterministically ordered
  by ID.

## Cursor and continuity rules

`olderCursor` is signed, opaque, expires after 24 hours, and is bound to the
organization, workspace, chat, direction, and page size. The signed cursor
position carries the branch-leaf snapshot. A branch cursor also carries the
exact next ancestor, its expected parent, and the
expected child at the page boundary. The next request validates both links.

Deletion, retention cleanup, reparenting, a dangling parent, a cycle, a cursor
from another tenant/query, or any malformed boundary fails closed. Invalid
signatures return `invalid_page_cursor`; a previously valid branch whose
continuity changed returns `message_page_reset_required`. Neither error reveals
message IDs or branch details. The client must discard its window and restart
from the current active leaf.

## Transcript snapshot version

Every chat has a database-backed `transcript_version` bigint. The API exposes
it as a decimal string in `meta.transcriptVersion`, avoiding JavaScript integer
precision loss. It is privacy-safe metadata: it contains no message, tenant, or
branch identifiers and is returned only after the normal authorized chat read.
The value is monotonic but not promised to be gapless; one user operation can
perform several structural writes in a transaction.

The first page snapshots the authorized chat's current version. Every signed
cursor carries that version in addition to the fixed branch leaf and boundary.
The repository compares the expected version with the tenant/workspace/chat row
inside the same read-only repeatable-read transaction that walks the page. A
stale version, stale leaf, changed boundary, or mixed version fails with the
same privacy-safe `message_page_reset_required` response. Thus an edit, insert,
delete, reparent, terminal append, or branch switch can never silently combine
rows from two transcript structures.

The legacy full-list response is not conditional or paged, so it does not need
a second compatibility envelope. `Chat` responses include the additive version
field and message-page responses carry the required typed metadata. Romeo does
not emit an HTTP ETag or implement `If-None-Match` for this operation: a 304
would skip the typed reset/current-leaf metadata, generated transports do not
model that alternate response cleanly, and authorization plus signed cursor
scope must still be evaluated on every read. A typed version is therefore the
safer contract.

The optimistic assistant row remains a separate message-scoped TanStack cache
entry while SSE is active. Token deltas do not mutate persisted topology and do
not advance this version. A page reset cancels and clears only that chat's
historical page queries; the live-row cache survives. Terminal persistence
creates the assistant message and advances the leaf transactionally, after
which the existing run reconciliation commits the complete row exactly once.

### Mutation coverage

| Persisted mutation                                         | Version mechanism and atomicity                                                                                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat creation                                              | Starts at version `0`, representing the initial empty snapshot.                                                                                                                                                                                              |
| Message create, run-start user row, terminal assistant row | PostgreSQL statement-level insert trigger increments every affected chat in the writer's transaction; the in-memory repository increments synchronously.                                                                                                     |
| Import/fork/OpenWebUI message creation                     | These paths use `createMessage`, so they share the same trigger/repository invariant. Bulk PostgreSQL inserts advance once per affected chat per statement.                                                                                                  |
| Message edit or reparent                                   | The PostgreSQL transition-table update trigger compares complete old/new message rows and advances both old/new chats when scope moves. Current edit-and-resend creates a new branch through `createMessage`; delete-time child reparenting is also covered. |
| Message delete                                             | The PostgreSQL repository wraps child reparent, row delete, active-leaf repair, and all trigger increments in one transaction. The in-memory transaction implementation snapshots and rolls back the version with the rows.                                  |
| Whole-chat delete/retention purge                          | PostgreSQL deletes the message graph and chat in one deletion transaction. Message triggers may advance the doomed chat row, but the row and every cursor scope disappear in the same commit, so no surviving snapshot can be mixed.                         |
| Active-leaf/variant switch                                 | A `BEFORE UPDATE OF active_leaf_message_id` trigger advances the version in the same row update; the in-memory `updateChat` does the same only when the pointer changes.                                                                                     |
| Run terminal settlement                                    | Assistant creation and leaf advancement already execute inside the terminal repository transaction; both version changes commit or roll back with the run.                                                                                                   |
| Nonstructural chat rename/archive/policy changes           | Do not advance the transcript version. Message-part retention is likewise not message topology.                                                                                                                                                              |

Migration `0020_chat_transcript_version` is additive and previous-version
compatible. Its four restart-safe triggers cover database writes even if a
future application path bypasses the current service helpers. The strict
migration ledger records upgrade, restart, repair, backup/restore, tenant-purge,
and schema-contract evidence locations. Shared conformance runs the same
monotonicity and rollback contract against memory and a migrated live
PostgreSQL database.

The migration rehearsal upgraded a populated PostgreSQL 16 database from
`0019`, applied `0020` twice, and retained exactly four non-internal version
triggers. The existing transcript began at `0`; insert, content edit, reparent,
leaf switch, and delete advanced it to `1`, `2`, `3`, `4`, and `5`. A logical
dump restored version `5` plus all four triggers, and a post-restore insert
advanced to `6`. Deleting the tenant's chat then left zero chat and message
rows. The isolated database/container was removed after the rehearsal.

Legal hold affects destructive retention, not authorized reads. Every request
reauthorizes tenant, workspace, chat, grants, and the caller's current auth
state through the normal request pipeline.

## Bounds and storage

The default page size is 50 and the maximum is 100. Branch traversal is capped
at `limit + 1`, protected by a two-second PostgreSQL statement timeout, and
uses primary-key parent lookups. Linear compatibility mode uses the composite
`(chat_id, created_at, id)` index. Attachment parts for returned messages are
loaded in one bounded query.

Migration `0019_message_page_keyset_index` is expand-only: it adds the
three-column keyset index and intentionally leaves the legacy two-column index
in place for the compatibility window. A later measured contract migration can
remove the old index after legacy query traffic is retired.

Migration `0021_exact_chat_branch_selection` adds a sibling lookup index and
durable queued-turn parent selection. Each page returns compact navigation only
for variant points on that page: selected message ID, zero-based position,
total, and authorized previous/next descendant-leaf targets. Sibling bodies are
never downloaded. PostgreSQL resolves all adjacent targets in one bounded
recursive query; memory uses the same deterministic ordering.

Live PostgreSQL 16 + pgvector conformance applied the full migration chain and
proved the same root and nested variant positions/descendant-leaf targets as
the in-memory repository. The acceptance also verifies that multiple adjacent
roots are bound as separate SQL parameters (never interpolated as an array or
identifier). The disposable database was removed after the passing run.

## Client prerequisite and active-path ownership

Branch ownership is reader-scoped through the explicit `leaf` URL parameter.
On a link without `leaf`, the authorized first page uses the chat-wide active
leaf only as a default and the router immediately canonicalizes it with replace
navigation. Variant arrows push the server-returned leaf target. Reload,
deep-link, Back, and Forward therefore restore that reader's path. A missing or
unauthorized leaf produces only the privacy-safe reset code; the router removes
the invalid leaf and returns to the authorized default.

The stored `chats.active_leaf_message_id` remains the shared default and server
run compatibility pointer; selecting a UI variant does not PATCH it. Thus one
collaborator cannot move another reader. `activeBranchChanged` is informational
for an explicit reader and does not itself invalidate the window. A changed
`transcriptVersion` does invalidate a continuation; the client cancels that
chat's page reads, discards its cursors, and refetches the same explicit leaf.

Accepted turns receive the persisted input-message ID in the 202 response.
That row and the deterministic terminal assistant ID live briefly in a
client-only optimistic overlay; token deltas remain in the exact live-row key.
The turn request and queued-turn record both persist the explicit current path
tip (including explicit `null` for the root), so a concurrent shared-default
change cannot redirect execution. After terminal page reconciliation, only that
run's overlay rows and scoped live row are removed. Historical pages remain the
sole server transcript cache and never double-fetch `listMessages`.

Older pages are loaded from an accessible button. The viewport records its
height and scroll position before insertion. TanStack's direct-DOM canvas size
can settle after the parent React layout effect, so restoration follows that
bounded size transition for at most 48 animation frames, waits for 18 stable
frames, and performs one delayed two-frame verification for late browser row
measurement. Native scroll anchoring is disabled only on the virtual canvas so
it cannot compete with the retained-row correction. This path runs only for an
explicit older-page load, never for token deltas. It preserves the exact pixel
anchor without moving keyboard focus or introducing animated motion. Page
message bodies are excluded from SSR
dehydration; generated query clients are request/browser scoped, preserving SSR
and tenant-cache isolation.

## Client rendering window

At 60 loaded rows the chat uses the existing `@tanstack/react-virtual`
dependency with stable message IDs, six-row overscan, direct DOM positioning,
and `ResizeObserver` measurement. Initial estimates use role, content length,
and attachment count; the measured height becomes authoritative for Markdown,
code, tables, media, speech, and artifact controls. The isolated optimistic
assistant remains the final message item, and only that mounted row observes
the message-scoped live cache. Windowing neither changes page/query keys nor
copies streaming content into historical topology.

The server snapshot and the first hydration snapshot render every loaded row in
document order. A pure client mount windows immediately, so opening a large
client-fetched chat does not first construct its complete Markdown DOM. Without
JavaScript or `ResizeObserver`, the complete loaded transcript remains readable.
No hidden full-text mirror is retained in windowed mode, avoiding duplicate
content, memory, accessibility, and sensitive-data surfaces.

One `IntersectionObserver`, rooted in the conversation viewport, supplies all
mounted rows with near-visibility state and a 400-pixel prewarm margin. There is
no observer instance per message. Offscreen rows defer the dynamic highlight,
math, KaTeX CSS, and Mermaid imports; an in-flight Mermaid render is ignored
after suspension, and an existing SVG is detached until the row returns. The
strict Mermaid security level and inert raw-HTML policy are unchanged. Generated
speech uses `preload="none"` and is paused when hidden, while attachment images
retain native lazy loading. The complete-DOM accessibility fallback combines
the shared observer with `content-visibility`; the virtual mode only measures
its bounded mounted rows. Visibility changes never touch message queries, the
run registry, or the live-row buffer, so an offscreen stream cannot lose tokens.

The transcript is a named semantic `feed`. Each message is an `article` with a
stable encoded fragment ID, stable hidden `h2`, `aria-labelledby`, and
`aria-posinset`/`aria-setsize`. Focused and fragment-targeted rows remain in the
virtual range. A fragment navigation scrolls and focuses the exact message.
Multi-row selection switches to the complete loaded DOM before continuing.
Cmd/Ctrl+F while the transcript has focus does the same, and an always-visible
“Show all loaded messages” control provides the explicit path for browser find,
continuous assistive-technology reading, or find invoked from elsewhere. The
reader can return to windowed mode. All jumps use `auto`; reduced-motion users
receive no smooth scrolling or row animation. The existing load-earlier button
stays in normal tab/document order, names its transcript through
`aria-controls`, describes anchor preservation, and retains focus through
prepend.

### Performance evidence

`pnpm test:browser:transcript-virtualization` runs one hermetic six-case matrix:
Chromium 149.0.7827.55, Firefox 151.0, and WebKit 26.5 at a 1280×900 desktop
viewport and a 390×844, 2×-DPR touch-emulated mobile viewport. Every case uses
reduced motion, 1,200 variable-height prose/code/table/artifact rows, 30 large
scrolls, a 100-row prepend, deep-link/focus retention, multi-row selection, and
keyboard browser-find fallback (Control+F on desktop and Meta+F in the mobile
case). All six passed.

Across the matrix, initial mounted rows were 10–11, maximum mounted rows were
17–18, active heavy-work rows were at most 6, prepend drift was zero pixels,
React commits were 48–59, and row-render calls were 643–716. The focused
offscreen row remained mounted while its expensive work was suspended. Selected
Axe ARIA, role, duplicate-ID, and heading rules reported zero violations in both
windowed and 1,300-row complete modes. The enforced budgets are 30 initial/36
maximum rows, 18 active heavy rows, 60 commits, 900 row renders, and two pixels
of anchor drift. Chromium additionally exposed precise heap metrics and stayed
under the 32 MiB growth budget (2,059,215 bytes maximum in this run) and exposed
the Long Tasks API with zero tasks over 50 ms. Firefox and WebKit exposed
neither precise heap nor Long Tasks metrics, so those budgets are recorded as
not applicable rather than inferred from missing data. Metric applicability is
stored per case. Metadata-only evidence is written to
`dist/ci/transcript-virtualization-browser-benchmark.json`.

This closes the automatable Chromium/Firefox/WebKit desktop/mobile,
reduced-motion, keyboard, DOM-bound, anchor, and selected semantic evidence. It
is not a complete WCAG audit or a manual NVDA, JAWS, or VoiceOver session, and
touch emulation is not physical-device momentum-scroll or production-device
certification. EP-04-15 remains open only for those external
assistive-technology and physical-device checks.

## Current-chat search

`GET /api/v1/chats/{chatId}/messages/search` is distinct from the workspace-wide
`GET /api/v1/chats/query` discovery endpoint. It searches only persisted message
content in one authorized chat. The service requires `chats:read`, resolves the
normal chat owner/grant/admin ACL before searching, and passes organization,
workspace, chat, and transcript-version scope into the repository. PostgreSQL
repeats every scope predicate in the search statement; a mismatched tenant
returns no result metadata or content.

Queries are NFKC-normalized, trimmed, case-insensitive, and bounded to 2–200
characters. Results are chronological and return at most 50 rows per request
(25 in the UI), a maximum 242-character plain-text snippet, role, timestamp,
and `active`/`alternate` branch indication. The reader-scoped
`branchLeafMessageId` is the matching message itself, allowing an exact
deep-link without mutating the shared active leaf or another collaborator's
view. The isolated optimistic/live assistant row is deliberately absent until
terminal persistence; search never reads or writes its message-scoped cache.

The opaque HMAC cursor expires after 24 hours and is bound to organization,
workspace, chat, normalized query, ordering, limit, and structural transcript
version. PostgreSQL executes each page in a read-only repeatable-read
transaction with a two-second statement timeout. Memory and PostgreSQL return
the same chronological page, exact total, active-path annotation, and next
position. A structural insert, edit, reparent, delete, retention purge, or
branch change advances `transcriptVersion`; continuation then fails with the
privacy-safe reset response. The client cancels and resets only that exact
generated infinite-query key, leaving historical transcript pages and the live
row untouched.

The UI is a separate session-bar current-chat control. Input is debounced by
250 ms; generated TanStack Query options forward cancellation to fetch and are
never dehydrated. A polite count reports exact results. Arrow Down/Enter and
Arrow Up, plus named previous/next buttons, navigate loaded cursor results;
Escape closes and restores trigger focus. The selected plain-text snippet and
branch label are visible without injecting result HTML, and fragment navigation
uses the existing stable encoded message target and virtual-row pinning.

No schema migration was required: the greenfield baseline already provides
`messages_content_trgm_idx` and the chat/order indexes. A disposable migrated
PostgreSQL 16 + pgvector conformance run passed all 63 repository tests. Its
100,000-message plan gate selected `messages_content_trgm_idx`; the in-memory
suite covers cursor/query/limit/version binding, alternate branches, deletion,
and cross-tenant denial. Contract/API, generated TypeScript/Python SDK, query
option, localized EN/ES/FR, keyboard/focus, and privacy-safe error tests provide
the remaining automated evidence.
