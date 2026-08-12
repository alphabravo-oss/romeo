INSERT INTO "resource_grants" (
  "id",
  "org_id",
  "resource_type",
  "resource_id",
  "principal_type",
  "principal_id",
  "permission",
  "created_at"
)
SELECT
  'grant_ws_backfill_' || u.id || '_' || w.id,
  u.org_id,
  'workspace',
  w.id,
  'user',
  u.id,
  'read',
  NOW()
FROM users u
INNER JOIN workspaces w ON w.org_id = u.org_id
ON CONFLICT (
  "org_id",
  "resource_type",
  "resource_id",
  "principal_type",
  "principal_id",
  "permission"
) DO NOTHING;
