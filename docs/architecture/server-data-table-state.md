# Server-owned data table state

Romeo's shared `DataTable` uses TanStack Table for rendering and interaction,
but it does not pretend that an API page is the full dataset. `ServerTableState`
is the explicit boundary between a resource controller and the shared table. It
contains controlled sorting, search and filter state, page size, fetch state,
exact/estimated/unknown total mode, and next/previous page actions. Supplying it
enables manual sorting and filtering and disables client pagination and CSV
export over an incomplete page.

The resource controller, rather than the table, owns opaque cursor history.
Changing any query-defining dimension resets that history synchronously before
another page can be requested. A stale or invalid cursor returns to page one
with a safe status message. The table never derives a cursor from a row index.

Audit logs are the reference URL-synchronized implementation. The admin route
strictly validates and bounds category, outcome, noise inclusion, range, sort
direction, and the supported page-size set. Default values are omitted from the
canonical URL. Tenant-bound cursors, free-text search, event selections, request
IDs, and event content are deliberately absent from route search. Browser
back/forward or a shared URL changes the controller scope key, which discards
old cursor history before the next request.

The query remains a factory-owned TanStack Query with `AbortSignal`
propagation, exact keys containing the complete server request, debounced
indexed search, previous-page presentation during fetch, and explicit
stale-cursor recovery. Webhook delivery paging reuses the same table
presentation contract with its own resource-specific cursor controller.

Tests cover route normalization and default elision, search bounds, cursor
history, scope resets, page-size and sort changes, debounce, stale recovery,
server/manual TanStack behavior, and table pagination semantics. EP-03-06 stays
open for applying validated URL state to every remaining shareable enterprise
inventory; this implementation does not put sensitive filters or opaque cursors
in a URL merely to satisfy a generic synchronization rule.
