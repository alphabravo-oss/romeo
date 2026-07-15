# Data Connector Intake

Romeo data connectors must enter through the catalog and adapter contract before they are exposed to admins or workers. This keeps connector growth reviewable and avoids one-off service logic.

## Catalog Contract

Use `GET /api/v1/data-connectors/catalog` to inspect supported connector types, typed config keys, credential source posture, execution driver posture, egress posture, fetch timeout/byte/retry limits, and stable blocked reasons. The endpoint is metadata-only: it reports counts and booleans, not allowed-host values, endpoint URLs, secret refs, tokens, or credentials.

Managed connector creation is gated by the same catalog runtime posture. If the selected connector type has stable runtime blockers such as `connector_driver_not_enabled`, `egress_allowlist_required`, `s3_endpoint_missing`, or `s3_credentials_not_configured`, `POST /api/v1/data-connectors` returns `409 connector_runtime_not_configured` with only `type` and `blockedReasons`. Local imports remain creatable because they use inline API ingest and no outbound executor.

The TypeScript SDK exposes this as `client.dataConnectors.catalog()`. The generated Python SDK includes `get_data_connectors_catalog`.

## Intake Checklist

Every new connector must define:

- Connector type, display name, supported sync mode, and execution boundary in `packages/core/src/domain/data-connector-catalog.ts`.
- Config normalization and validation in the data connector service, with typed required and optional keys.
- Executor module with bounded egress, timeout, byte limits, redirect policy, bounded retry/rate-limit behavior, credential source rules, and metadata-only sync summaries.
- Authorization behavior for workspace, knowledge-base, source ownership, and connector-owner source visibility.
- Redaction tests proving raw credentials, connector payloads, source content, and provider responses stay out of audits, jobs, usage, sync summaries, logs, and support bundles.
- Compose and Kubernetes deployment notes, including required env, Secret refs, NetworkPolicy or allowlist expectations, and worker scheduling.
- Deletion and re-sync behavior, including cursor reuse, superseded source cleanup, object/vector cleanup, and restore expectations.

## Current Built-Ins

- `local_import`: inline API ingest, no network egress.
- `website` and `rss`: HTTPS-only bounded fetches, optional host allowlist, fail-closed allowlist policy, literal and DNS-resolved private-network denial when the production factory is used, and bounded transient retry.
- `github`: bounded GitHub API fetches, deployment token, connector secret ref, or delegated OAuth, with bounded retry for rate-limit and transient server responses.
- `s3`: bounded S3-compatible list/get, deployment credentials or connector secret ref, with bounded transient retry.
- `confluence` and `jira`: bounded Atlassian Cloud/Data Center API fetches using CQL/JQL, connector secret refs only, host allowlists, literal and DNS-resolved private-network denial, and metadata-only sync summaries that hash query strings instead of returning them.
- `notion`: bounded Notion `/v1/search` page discovery plus bounded page-block child reads, explicit `Notion-Version`, connector secret refs only, host allowlists, literal and DNS-resolved private-network denial, and metadata-only sync summaries that hash search queries instead of returning them.
- `linear`: bounded Linear GraphQL issue import with a fixed issue query shape, optional local text filter, connector secret refs only, host allowlists, literal and DNS-resolved private-network denial, and metadata-only sync summaries that hash local filter queries instead of returning them.
- `slack`: bounded Slack `conversations.history` channel message import, explicit validated channel IDs, connector secret refs only, host allowlists, literal and DNS-resolved private-network denial, and metadata-only sync summaries that hash channel IDs instead of returning them.

Future connectors must preserve the same rule: app/API surfaces store metadata and governed content only; raw connector credentials and hidden payload values stay inside the approved executor boundary.
