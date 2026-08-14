# Data table dataset inventory

This inventory is the source of truth for EP-03 table ownership. The machine-readable classification is [`data-table-inventory.json`](./data-table-inventory.json), and `node scripts/check-data-table-inventory.mjs` fails when a `DataTable` instance is added, removed, duplicated, or marked as server-driven without wiring the shared `serverPagination` contract.

## Classification rules

- `bounded-client`: the API contract guarantees a naturally small policy/configuration or aggregate result. Client sorting, filtering, export, and selection are safe because the complete bounded result is intentionally present.
- `virtualized-client`: the complete result is intentionally fetched for a product reason, but rendering needs virtualization. This is not a substitute for server paging. No current Romeo dataset qualifies; future use requires a documented upper bound and memory profile.
- `server-driven`: row count can grow with users, time, messages, events, provider inventory, or customer data. Search, filtering, sorting, paging, bulk selection, and export must be owned by the server contract.

`status: implemented` means the current table supplies the shared `serverPagination` controller when classified as server-driven. `migration_required` is explicit debt and must not be mistaken for a bounded list merely because the current endpoint returns an array.

## Current result

The ratchet currently covers 66 table instances across 48 application component files. It identifies 39 server-driven migrations. Existing implemented server paging includes audit events, the model catalog, users, and webhook deliveries. Audit events are the first panel using the complete `ServerTableState` boundary against the strict POST table-query endpoint: opaque cursor history, controlled `createdAt` sort, typed server filters, debounced/cancellable search, configurable page size, estimated totals, and stale-cursor recovery are live. URL synchronization, server-saved views, and asynchronous export jobs remain explicit audit-table debt. Bounded operational summaries and configuration matrices remain client-owned by design.

The migration order is risk- and scale-based:

1. Usage events, notifications/deliveries, sessions, API/device credentials, tool operations/traces, connector sync runs, workflow/eval runs, provider sync failures, and background jobs.
2. Knowledge sources, personal content, managed models, provider models/connections, service accounts, groups/members, organizations, and webhook endpoints.
3. Lower-churn catalogs and historical configuration such as agent versions, templates, export packages, and resource-grant inventories.

Each migration must add an opaque cursor, allowlisted sort/filter schema, stable tenant predicate and tie-breaker, query-plan evidence, URL state, cancellation, distinct empty/error states, and exact TanStack query keys. Cross-page bulk actions use a frozen query fingerprint rather than enumerating browser-loaded rows. Large CSV exports become asynchronous access-controlled jobs instead of browser-side serialization.

The shared cursor primitive is `packages/core/src/services/page-cursor.ts`. It emits versioned, HMAC-authenticated, purpose-separated tokens; binds each token to the tenant/filter/sort fingerprint; supports bounded expiry and previous rotation keys; validates a resource-specific keyset position; and collapses malformed, tampered, expired, cross-resource, or cross-query tokens to one safe error. Webhook delivery paging is the first migrated consumer and preserves its public resource-specific error code. New server-driven endpoints must use this primitive rather than introducing another base64 cursor format.

`@romeo/contracts/server-table` defines the common strict query policy and response envelope. A resource must declare every sortable field and the exact operators/value schema for every filter field. Search is rejected unless explicitly enabled. This makes the parsed field names safe inputs to a resource-owned mapping; repositories must still map those enums to static SQL expressions and must never interpolate a field string.

`@romeo/ui` exposes one `ServerTableState` presentation boundary for cursor/page history, controlled sorting/search/filter state, page size, fetch state, and exact/estimated/unknown totals. It keeps route and TanStack Query ownership outside the table and disables misleading browser-side CSV export for that mode. `AuditPanel` now binds that controller to a resource query factory but intentionally does not claim EP-03 URL-state, saved-view, or export-job completion. The remaining EP-03 migrations must bind this state to validated TanStack Router search params and resource query factories; the legacy callback-only `serverPagination` prop remains temporarily compatible during migration.

## Validation

Run:

```sh
mise x node@24 -- node scripts/check-data-table-inventory.mjs
```

The checker deliberately validates source instances rather than relying on a manually maintained count in this document.
