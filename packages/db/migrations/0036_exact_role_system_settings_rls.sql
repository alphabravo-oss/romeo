ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS org_id text,
  ADD COLUMN IF NOT EXISTS scope_org_id text;

DO $system_settings_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'system_settings'::regclass
      AND conname = 'system_settings_org_id_organizations_id_fk'
  ) THEN
    ALTER TABLE system_settings
      ADD CONSTRAINT system_settings_org_id_organizations_id_fk
      FOREIGN KEY (org_id) REFERENCES organizations(id);
  END IF;
END $system_settings_fk$;

UPDATE system_settings setting
SET org_id = organization.id
FROM organizations organization
WHERE setting.org_id IS NULL
  AND setting.value ->> 'orgId' = organization.id;

UPDATE system_settings setting
SET org_id = organization.id
FROM organizations organization
WHERE setting.org_id IS NULL
  AND organization.id = ANY(
    string_to_array(replace(setting.key, '/', ':'), ':')
  )
  AND (
    left(setting.key, length('abuse_controls.org.v1:')) = 'abuse_controls.org.v1:'
    OR left(setting.key, length('auth_provider_settings.org.v1:')) = 'auth_provider_settings.org.v1:'
    OR left(setting.key, length('chat_experience.v1:')) = 'chat_experience.v1:'
    OR left(setting.key, length('content_policy.')) = 'content_policy.'
    OR left(setting.key, length('content_policy.v1:')) = 'content_policy.v1:'
    OR left(setting.key, length('image_job.v1:')) = 'image_job.v1:'
    OR left(setting.key, length('interface_preferences.v1:')) = 'interface_preferences.v1:'
    OR left(setting.key, length('model.capability.')) = 'model.capability.'
    OR left(setting.key, length('notification_policy.org.v1:')) = 'notification_policy.org.v1:'
    OR left(setting.key, length('policy_bundle.v1:')) = 'policy_bundle.v1:'
    OR left(setting.key, length('rag_policy.')) = 'rag_policy.'
    OR left(setting.key, length('reasoning_policy.org.v1:')) = 'reasoning_policy.org.v1:'
    OR left(setting.key, length('retention-progress:')) = 'retention-progress:'
    OR left(setting.key, length('table_view.v2:')) = 'table_view.v2:'
    OR left(setting.key, length('tenant_lifecycle.')) = 'tenant_lifecycle.'
    OR left(setting.key, length('web_search.')) = 'web_search.'
  );

WITH uniquely_owned_managed_secrets AS (
  SELECT resource_id, min(org_id) AS org_id
  FROM audit_logs
  WHERE action = 'admin.managed_secret.create'
    AND resource_type = 'managed_secret'
    AND metadata ->> 'scope' = 'org'
  GROUP BY resource_id
  HAVING count(DISTINCT org_id) = 1
)
UPDATE system_settings setting
SET org_id = ownership.org_id
FROM uniquely_owned_managed_secrets ownership
WHERE setting.org_id IS NULL
  AND setting.key = 'managed_secret.v1:' || ownership.resource_id;

CREATE INDEX IF NOT EXISTS system_settings_org_key_idx
  ON system_settings (org_id, key);

UPDATE system_settings
SET scope_org_id = org_id
WHERE scope_org_id IS NULL
  AND org_id IS NOT NULL;

UPDATE system_settings
SET scope_org_id = '__global__'
WHERE scope_org_id IS NULL
  AND org_id IS NULL
  AND (
    key = 'auth_provider_settings.global.v1'
    OR key = 'temporary-chat-cleanup.v1'
    OR left(key, length('scheduled-work.')) = 'scheduled-work.'
    OR left(
      key,
      length('tenant_lifecycle.deletion_purge_result.v1:')
    ) = 'tenant_lifecycle.deletion_purge_result.v1:'
    OR (
      left(key, length('managed_secret.v1:')) = 'managed_secret.v1:'
      AND value ->> 'scope' = 'global'
    )
  );

DO $unresolved_system_settings$
DECLARE
  unresolved_count bigint;
  unresolved_key_hashes text;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM system_settings
  WHERE scope_org_id IS NULL;
  SELECT string_agg(key_hash, ',' ORDER BY key_hash)
  INTO unresolved_key_hashes
  FROM (
    SELECT md5(key) AS key_hash
    FROM system_settings
    WHERE scope_org_id IS NULL
    ORDER BY md5(key)
    LIMIT 20
  ) unresolved;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'migration 0036 cannot classify %s legacy system_settings row(s); key_md5=%s',
        unresolved_count,
        coalesce(unresolved_key_hashes, '')
      );
  END IF;
END $unresolved_system_settings$;

ALTER TABLE system_settings
  ALTER COLUMN scope_org_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS system_settings_scope_matches_org,
  DROP CONSTRAINT IF EXISTS system_settings_pkey;
ALTER TABLE system_settings
  ADD CONSTRAINT system_settings_scope_matches_org CHECK (
    (scope_org_id = '__global__' AND org_id IS NULL)
    OR scope_org_id = org_id
  ),
  ADD CONSTRAINT system_settings_pkey PRIMARY KEY (scope_org_id, key);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS romeo_tenant_isolation ON system_settings;
CREATE POLICY romeo_tenant_isolation ON system_settings
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
GRANT SELECT, INSERT, UPDATE, DELETE ON system_settings
  TO romeo_tenant_runtime, romeo_system_coordinator;

DO $exact_role_rls$
DECLARE
  tenant_table record;
BEGIN
  FOR tenant_table IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name = 'org_id'
      AND table_name <> 'system_settings'
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS romeo_tenant_isolation ON public.%I',
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY romeo_tenant_isolation ON public.%I USING (
        current_user = ''romeo_system_coordinator''
        OR (
          current_user = ''romeo_tenant_runtime''
          AND org_id = nullif(current_setting(''romeo.tenant_id'', true), '''')
        )
      ) WITH CHECK (
        current_user = ''romeo_system_coordinator''
        OR (
          current_user = ''romeo_tenant_runtime''
          AND org_id = nullif(current_setting(''romeo.tenant_id'', true), '''')
        )
      )',
      tenant_table.table_name
    );
  END LOOP;

  DROP POLICY IF EXISTS romeo_tenant_isolation ON organizations;
  CREATE POLICY romeo_tenant_isolation ON organizations
    USING (
      current_user = 'romeo_system_coordinator'
      OR (
        current_user = 'romeo_tenant_runtime'
        AND id = nullif(current_setting('romeo.tenant_id', true), '')
      )
    )
    WITH CHECK (
      current_user = 'romeo_system_coordinator'
      OR (
        current_user = 'romeo_tenant_runtime'
        AND id = nullif(current_setting('romeo.tenant_id', true), '')
      )
    );
END $exact_role_rls$;
