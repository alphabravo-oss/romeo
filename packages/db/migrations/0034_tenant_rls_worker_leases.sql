DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'romeo_tenant_runtime') THEN
    CREATE ROLE romeo_tenant_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'romeo_system_coordinator') THEN
    CREATE ROLE romeo_system_coordinator NOLOGIN NOINHERIT NOBYPASSRLS;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION USING
      MESSAGE = 'RLS role creation requires CREATEROLE; provision romeo_tenant_runtime and romeo_system_coordinator before retrying migration 0034';
END $$;

ALTER ROLE romeo_tenant_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
ALTER ROLE romeo_system_coordinator NOLOGIN NOINHERIT NOBYPASSRLS;

COMMENT ON ROLE romeo_tenant_runtime IS
  'Romeo request role. Every transaction must set LOCAL romeo.tenant_id.';
COMMENT ON ROLE romeo_system_coordinator IS
  'Romeo audited cross-tenant scheduler role. Never grant to request-serving identities.';

ALTER TABLE data_connectors
  ADD COLUMN IF NOT EXISTS sync_lease_owner text,
  ADD COLUMN IF NOT EXISTS sync_lease_token text,
  ADD COLUMN IF NOT EXISTS sync_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_fence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE data_connector_syncs
  ADD COLUMN IF NOT EXISTS fencing_token integer,
  ADD COLUMN IF NOT EXISTS lease_token text;

ALTER TABLE knowledge_sources
  ADD COLUMN IF NOT EXISTS extraction_lease_owner text,
  ADD COLUMN IF NOT EXISTS extraction_lease_token text,
  ADD COLUMN IF NOT EXISTS extraction_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS extraction_fence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extraction_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_token text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_fence integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lease_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS provider_idempotency_key text;

CREATE INDEX IF NOT EXISTS data_connectors_due_sync_lease_idx
  ON data_connectors (org_id, status, next_sync_at, sync_lease_expires_at);
CREATE INDEX IF NOT EXISTS knowledge_sources_extraction_claim_idx
  ON knowledge_sources (org_id, status, extraction_lease_expires_at, updated_at);
CREATE INDEX IF NOT EXISTS notification_delivery_status_lease_idx
  ON notification_deliveries (org_id, status, lease_expires_at, updated_at);
CREATE INDEX IF NOT EXISTS object_records_retention_keyset_idx
  ON object_records (org_id, updated_at, id)
  WHERE status <> 'deleted';

DO $rls$
DECLARE
  tenant_table record;
BEGIN
  FOR tenant_table IN
    SELECT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'org_id'
    ORDER BY table_name
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      tenant_table.table_name
    );
    EXECUTE format(
      'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
      tenant_table.table_name
    );
    EXECUTE format(
      'DROP POLICY IF EXISTS romeo_tenant_isolation ON public.%I',
      tenant_table.table_name
    );
    EXECUTE format(
      'CREATE POLICY romeo_tenant_isolation ON public.%I USING (
        pg_has_role(current_user, ''romeo_system_coordinator'', ''member'')
        OR (
          pg_has_role(current_user, ''romeo_tenant_runtime'', ''member'')
          AND org_id = nullif(current_setting(''romeo.tenant_id'', true), '''')
        )
      ) WITH CHECK (
        pg_has_role(current_user, ''romeo_system_coordinator'', ''member'')
        OR (
          pg_has_role(current_user, ''romeo_tenant_runtime'', ''member'')
          AND org_id = nullif(current_setting(''romeo.tenant_id'', true), '''')
        )
      )',
      tenant_table.table_name
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO romeo_tenant_runtime, romeo_system_coordinator',
      tenant_table.table_name
    );
  END LOOP;

  ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS romeo_tenant_isolation ON public.organizations;
  CREATE POLICY romeo_tenant_isolation ON public.organizations
    USING (
      pg_has_role(current_user, 'romeo_system_coordinator', 'member')
      OR (
        pg_has_role(current_user, 'romeo_tenant_runtime', 'member')
        AND id = nullif(current_setting('romeo.tenant_id', true), '')
      )
    )
    WITH CHECK (
      pg_has_role(current_user, 'romeo_system_coordinator', 'member')
      OR (
        pg_has_role(current_user, 'romeo_tenant_runtime', 'member')
        AND id = nullif(current_setting('romeo.tenant_id', true), '')
      )
    );
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations
    TO romeo_tenant_runtime, romeo_system_coordinator;
END $rls$;

DO $dependent_rls$
DECLARE
  dependency record;
  protected_tables oid[];
  added_count integer;
BEGIN
  SELECT array_agg(DISTINCT relation.oid)
  INTO protected_tables
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN information_schema.columns tenant_column
    ON tenant_column.table_schema = namespace.nspname
    AND tenant_column.table_name = relation.relname
    AND tenant_column.column_name = 'org_id'
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'r'
    AND (tenant_column.column_name IS NOT NULL OR relation.relname = 'organizations');

  LOOP
    added_count := 0;
    FOR dependency IN
      SELECT DISTINCT ON (child.oid)
        child.oid AS child_oid,
        child.relname AS child_table,
        parent.relname AS parent_table,
        (
          SELECT string_agg(
            format(
              'tenant_parent.%I = %I.%I',
              parent_attribute.attname,
              child.relname,
              child_attribute.attname
            ),
            ' AND ' ORDER BY key_column.ordinality
          )
          FROM unnest(foreign_key.conkey, foreign_key.confkey)
            WITH ORDINALITY AS key_column(child_attnum, parent_attnum, ordinality)
          JOIN pg_attribute child_attribute
            ON child_attribute.attrelid = child.oid
            AND child_attribute.attnum = key_column.child_attnum
          JOIN pg_attribute parent_attribute
            ON parent_attribute.attrelid = parent.oid
            AND parent_attribute.attnum = key_column.parent_attnum
        ) AS join_condition
      FROM pg_constraint foreign_key
      JOIN pg_class child ON child.oid = foreign_key.conrelid
      JOIN pg_namespace child_namespace
        ON child_namespace.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = foreign_key.confrelid
      WHERE foreign_key.contype = 'f'
        AND child_namespace.nspname = 'public'
        AND parent.oid = ANY(protected_tables)
        AND NOT child.oid = ANY(protected_tables)
      ORDER BY child.oid, parent.relname, foreign_key.conname
    LOOP
      EXECUTE format(
        'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
        dependency.child_table
      );
      EXECUTE format(
        'ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',
        dependency.child_table
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS romeo_tenant_isolation ON public.%I',
        dependency.child_table
      );
      EXECUTE format(
        'CREATE POLICY romeo_tenant_isolation ON public.%I
          USING (EXISTS (
            SELECT 1 FROM public.%I AS tenant_parent WHERE %s
          ))
          WITH CHECK (EXISTS (
            SELECT 1 FROM public.%I AS tenant_parent WHERE %s
          ))',
        dependency.child_table,
        dependency.parent_table,
        dependency.join_condition,
        dependency.parent_table,
        dependency.join_condition
      );
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO romeo_tenant_runtime, romeo_system_coordinator',
        dependency.child_table
      );
      protected_tables := array_append(
        protected_tables,
        dependency.child_oid
      );
      added_count := added_count + 1;
    END LOOP;
    EXIT WHEN added_count = 0;
  END LOOP;
END $dependent_rls$;
