# Data connectors and delegated OAuth are removed

The product owner approved removing the data connector and delegated OAuth
features before any public release. They pulled external content (websites,
RSS, GitHub, S3) into knowledge bases through a sync worker and stored
per-user OAuth tokens for those sources. Removing them shrinks the outbound
attack surface and the amount of credential material Romeo holds.

Removed operations:

- `GET/POST /data-connectors`, `GET /data-connectors/catalog`,
  `POST /data-connectors/{connectorId}/sync`,
  `GET /data-connectors/{connectorId}/syncs`
- `GET /admin/data-connectors/posture`
- `GET /delegated-oauth/providers`, `POST /delegated-oauth/start`,
  `GET /delegated-oauth/callback`, `GET /delegated-oauth/connections`,
  `POST /delegated-oauth/connections/{connectionId}/revoke`
- `GET /admin/delegated-oauth/posture`

Removed fields and values:

- `AccessReviewReport.connectorOwnership`,
  `summary.dataConnectorCount`, and `summary.delegatedOAuthConnectionCount`
- `dataConnectors` and `dataConnectorSyncs` from data-export counts and data
- `dataConnectors` from workspace export counts and resources
- `data_connector` from resource grant resource types
- `data_connector_credential` from managed secret purposes
- `delegatedOAuth` from the runtime key rotation posture report

Knowledge bases keep direct uploads and governed URL ingestion. Knowledge
sources that a connector imported earlier remain ordinary knowledge sources.

Because the feature never shipped, no deprecation window applies. The removed
surface was deleted from `docs/api/openapi-baseline.json` in the same change
instead of being carried as ledger approvals; the existing ledger entries for
unrelated changes are unaffected. Migration `0045_drop_data_connectors.sql`
drops the backing tables.
