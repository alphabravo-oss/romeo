-- Expand: record which identity-provider mapping created a group membership
-- or workspace resource grant so SSO logins can revoke memberships that the
-- same mapping no longer asserts. NULL means the row was created manually, by
-- SCIM, by directory sync, or before this migration; such rows are never
-- revoked by SSO reconciliation. Existing rows are intentionally left NULL.
ALTER TABLE "group_memberships" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "resource_grants" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_memberships_source_idx"
  ON "group_memberships" ("org_id", "user_id", "source")
  WHERE "source" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resource_grants_source_idx"
  ON "resource_grants" ("org_id", "principal_id", "source")
  WHERE "source" IS NOT NULL;
