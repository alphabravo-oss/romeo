CREATE UNIQUE INDEX IF NOT EXISTS workspaces_org_id_id_uidx
  ON workspaces (org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS users_org_id_id_uidx
  ON users (org_id, id);

CREATE TABLE IF NOT EXISTS server_table_saved_views (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  owner_user_id text NOT NULL,
  resource text NOT NULL,
  parent_id text,
  parent_scope_key text NOT NULL DEFAULT '',
  name text NOT NULL,
  name_normalized text NOT NULL,
  query jsonb NOT NULL,
  presentation jsonb NOT NULL,
  visibility text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  schema_version integer NOT NULL,
  version integer NOT NULL,
  delete_token_hash text,
  delete_token_expires_at timestamptz,
  deleted_was_default boolean,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT server_table_saved_views_org_workspace_fk
    FOREIGN KEY (org_id, workspace_id)
    REFERENCES workspaces(org_id, id) ON DELETE CASCADE,
  CONSTRAINT server_table_saved_views_org_owner_fk
    FOREIGN KEY (org_id, owner_user_id)
    REFERENCES users(org_id, id) ON DELETE CASCADE,
  CONSTRAINT server_table_saved_views_parent_scope_matches
    CHECK (parent_scope_key = coalesce(parent_id, '')),
  CONSTRAINT server_table_saved_views_visibility_valid
    CHECK (visibility IN ('private', 'workspace')),
  CONSTRAINT server_table_saved_views_versions_positive
    CHECK (schema_version > 0 AND version > 0),
  CONSTRAINT server_table_saved_views_query_shape_valid CHECK (
    jsonb_typeof(query) = 'object'
    AND jsonb_typeof(query -> 'sort') = 'array'
    AND jsonb_typeof(query -> 'filters') = 'array'
    AND (query ->> 'pageSize')::integer IN (10, 25, 50, 100)
  ),
  CONSTRAINT server_table_saved_views_delete_token_lifecycle_valid CHECK (
    (
      deleted_at IS NULL
      AND delete_token_hash IS NULL
      AND delete_token_expires_at IS NULL
      AND deleted_was_default IS NULL
    ) OR (
      deleted_at IS NOT NULL
      AND delete_token_hash IS NOT NULL
      AND delete_token_expires_at IS NOT NULL
      AND delete_token_expires_at > deleted_at
      AND deleted_was_default IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS server_table_saved_views_list_idx
  ON server_table_saved_views (
    org_id,
    workspace_id,
    resource,
    parent_scope_key,
    visibility,
    owner_user_id,
    name_normalized
  );
CREATE UNIQUE INDEX IF NOT EXISTS server_table_saved_views_active_owner_name_uidx
  ON server_table_saved_views (
    org_id,
    workspace_id,
    resource,
    parent_scope_key,
    owner_user_id,
    name_normalized
  ) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS server_table_saved_views_active_owner_default_uidx
  ON server_table_saved_views (
    org_id,
    workspace_id,
    resource,
    parent_scope_key,
    owner_user_id
  ) WHERE deleted_at IS NULL AND is_default = true;

INSERT INTO server_table_saved_views (
  id,
  org_id,
  workspace_id,
  owner_user_id,
  resource,
  parent_scope_key,
  name,
  name_normalized,
  query,
  presentation,
  visibility,
  is_default,
  schema_version,
  version,
  created_at,
  updated_at
)
SELECT
  view ->> 'id',
  setting.org_id,
  view ->> 'workspaceId',
  view ->> 'ownerUserId',
  view ->> 'resource',
  '',
  left(view ->> 'name', 80),
  lower(trim(view ->> 'name')),
  view -> 'query',
  view -> 'presentation',
  CASE WHEN view ->> 'visibility' = 'workspace'
    THEN 'workspace' ELSE 'private' END,
  coalesce((view ->> 'isDefault')::boolean, false),
  2,
  greatest(coalesce((view ->> 'version')::integer, 1), 1),
  coalesce((view ->> 'createdAt')::timestamptz, setting.updated_at),
  coalesce((view ->> 'updatedAt')::timestamptz, setting.updated_at)
FROM system_settings setting
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN jsonb_typeof(setting.value -> 'views') = 'array'
      THEN setting.value -> 'views'
    ELSE '[]'::jsonb
  END
) AS view
JOIN workspaces workspace
  ON workspace.id = view ->> 'workspaceId'
  AND workspace.org_id = setting.org_id
JOIN users owner_user
  ON owner_user.id = view ->> 'ownerUserId'
  AND owner_user.org_id = setting.org_id
WHERE setting.org_id IS NOT NULL
  AND setting.key LIKE 'table_view.v2:%'
  AND setting.value ->> 'schema' = 'romeo.server-table-view-store.v2'
  AND jsonb_typeof(setting.value -> 'views') = 'array'
  AND view ->> 'id' IS NOT NULL
  AND view ->> 'resource' IS NOT NULL
  AND nullif(trim(view ->> 'name'), '') IS NOT NULL
  AND jsonb_typeof(view -> 'query') = 'object'
  AND jsonb_typeof(view -> 'presentation') = 'object'
  AND (view -> 'query' ->> 'pageSize')::integer IN (10, 25, 50, 100)
ON CONFLICT DO NOTHING;

DELETE FROM system_settings setting
WHERE setting.key LIKE 'table_view.v2:%'
  AND setting.value ->> 'schema' = 'romeo.server-table-view-store.v2'
  AND jsonb_typeof(setting.value -> 'views') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(setting.value -> 'views') legacy_view
    WHERE NOT EXISTS (
      SELECT 1
      FROM server_table_saved_views migrated
      WHERE migrated.org_id = setting.org_id
        AND migrated.id = legacy_view ->> 'id'
    )
  );

ALTER TABLE server_table_saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_table_saved_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS romeo_tenant_isolation ON server_table_saved_views;
CREATE POLICY romeo_tenant_isolation ON server_table_saved_views
  USING (
    current_user = 'romeo_system_coordinator'
    OR (
      current_user = 'romeo_tenant_runtime'
      AND org_id = nullif(current_setting('romeo.tenant_id', true), '')
    )
  )
  WITH CHECK (
    current_user = 'romeo_system_coordinator'
    OR (
      current_user = 'romeo_tenant_runtime'
      AND org_id = nullif(current_setting('romeo.tenant_id', true), '')
    )
  );
GRANT SELECT, INSERT, UPDATE, DELETE ON server_table_saved_views
  TO romeo_tenant_runtime, romeo_system_coordinator;
