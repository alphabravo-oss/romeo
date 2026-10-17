-- Contract: data connectors and delegated OAuth were removed from the product.
-- Drops the connector sync history, connector definitions, and per-user
-- delegated OAuth token records together with their indexes, foreign keys,
-- and tenant RLS policies. Knowledge sources previously imported by a
-- connector are ordinary knowledge sources and are retained.
DELETE FROM "resource_grants" WHERE "resource_type" = 'data_connector';
--> statement-breakpoint
DROP TABLE IF EXISTS "data_connector_syncs";
--> statement-breakpoint
DROP TABLE IF EXISTS "data_connectors";
--> statement-breakpoint
DROP TABLE IF EXISTS "delegated_oauth_connections";
