CREATE TABLE IF NOT EXISTS governance_export_jobs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id text,
  created_by text NOT NULL,
  request jsonb NOT NULL,
  snapshot_at timestamptz NOT NULL,
  state text NOT NULL,
  percent integer NOT NULL DEFAULT 0,
  checkpoint jsonb NOT NULL,
  counts jsonb NOT NULL,
  limits jsonb NOT NULL,
  warnings jsonb NOT NULL,
  exclusions jsonb NOT NULL,
  error_code text,
  lease_owner text,
  lease_expires_at timestamptz,
  lease_attempt integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deleted_at timestamptz,
  CONSTRAINT governance_export_jobs_org_workspace_fk
    FOREIGN KEY (org_id, workspace_id)
    REFERENCES workspaces(org_id, id) ON DELETE CASCADE,
  CONSTRAINT governance_export_jobs_state_valid CHECK (
    state IN ('queued', 'running', 'artifact_ready', 'failed', 'expired', 'deleted')
  ),
  CONSTRAINT governance_export_jobs_progress_valid CHECK (
    percent BETWEEN 0 AND 100 AND lease_attempt >= 0 AND version > 0
  ),
  CONSTRAINT governance_export_jobs_payload_shape_valid CHECK (
    jsonb_typeof(request) = 'object'
    AND jsonb_typeof(checkpoint) = 'object'
    AND jsonb_typeof(counts) = 'object'
    AND jsonb_typeof(limits) = 'object'
    AND jsonb_typeof(warnings) = 'array'
    AND jsonb_typeof(exclusions) = 'array'
    AND checkpoint ?& ARRAY[
      'datasetIndex', 'partCount', 'processedRows', 'sizeBytes'
    ]
    AND (checkpoint ->> 'datasetIndex')::bigint >= 0
    AND (checkpoint ->> 'partCount')::bigint >= 0
    AND (checkpoint ->> 'processedRows')::bigint >= 0
    AND (checkpoint ->> 'sizeBytes')::bigint >= 0
  ),
  CONSTRAINT governance_export_jobs_scope_valid CHECK (
    (request ->> 'scope' = 'org' AND workspace_id IS NULL)
    OR (
      request ->> 'scope' = 'workspace'
      AND workspace_id IS NOT NULL
      AND request ->> 'workspaceId' = workspace_id
    )
  ),
  CONSTRAINT governance_export_jobs_lease_valid CHECK (
    (state = 'running' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT governance_export_jobs_terminal_shape_valid CHECK (
    (state = 'artifact_ready' AND percent = 100 AND completed_at IS NOT NULL)
    OR state <> 'artifact_ready'
  ),
  CONSTRAINT governance_export_jobs_deleted_shape_valid CHECK (
    (state = 'deleted' AND deleted_at IS NOT NULL)
    OR (state <> 'deleted' AND deleted_at IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS governance_export_jobs_org_id_uidx
  ON governance_export_jobs (org_id, id);
CREATE INDEX IF NOT EXISTS governance_export_jobs_claim_idx
  ON governance_export_jobs (org_id, state, created_at, id);
CREATE INDEX IF NOT EXISTS governance_export_jobs_list_idx
  ON governance_export_jobs (org_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS governance_export_artifacts (
  id text PRIMARY KEY,
  job_id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  content_type text NOT NULL,
  file_name text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  part_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT governance_export_artifacts_org_job_fk
    FOREIGN KEY (org_id, job_id)
    REFERENCES governance_export_jobs(org_id, id) ON DELETE CASCADE,
  CONSTRAINT governance_export_artifacts_content_type_valid
    CHECK (content_type IN ('application/json', 'application/x-ndjson')),
  CONSTRAINT governance_export_artifacts_shape_valid
    CHECK (
      size_bytes >= 0
      AND part_count > 0
      AND sha256 ~ '^[a-f0-9]{64}$'
      AND expires_at > created_at
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS governance_export_artifacts_job_uidx
  ON governance_export_artifacts (org_id, job_id);
CREATE UNIQUE INDEX IF NOT EXISTS governance_export_artifacts_object_key_uidx
  ON governance_export_artifacts (object_key);
CREATE INDEX IF NOT EXISTS governance_export_artifacts_expiry_idx
  ON governance_export_artifacts (org_id, expires_at, id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM background_jobs
    WHERE type = 'governance.data_export.package_artifact'
      AND NOT (
        payload ->> 'schema' = 'romeo.data-export-package-artifact-record.v1'
        AND payload ->> 'state' IN ('active', 'deleted')
        AND jsonb_typeof(payload -> 'summary') = 'object'
        AND payload #>> '{summary,schema}' = 'romeo.data-export-package-summary.v1'
      )
  ) THEN
    RAISE EXCEPTION 'Malformed legacy governance export background job';
  END IF;
  IF EXISTS (
    SELECT 1 FROM system_settings
    WHERE key LIKE 'governance.data_export_packages.%'
      AND NOT (
        value ->> 'schema' = 'romeo.data-export-package-registry.v1'
        AND jsonb_typeof(value -> 'packages') = 'array'
      )
  ) THEN
    RAISE EXCEPTION 'Malformed legacy governance export registry';
  END IF;
END $$;

CREATE TEMP TABLE governance_export_legacy_packages ON COMMIT DROP AS
SELECT org_id, payload -> 'summary' AS summary
FROM background_jobs
WHERE type = 'governance.data_export.package_artifact'
  AND payload ->> 'state' = 'active'
UNION ALL
SELECT setting.org_id, package.summary
FROM system_settings setting
CROSS JOIN LATERAL jsonb_array_elements(setting.value -> 'packages')
  AS package(summary)
WHERE setting.key LIKE 'governance.data_export_packages.%';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM governance_export_legacy_packages
    WHERE NOT (
      summary ->> 'schema' = 'romeo.data-export-package-summary.v1'
      AND jsonb_typeof(summary -> 'request') = 'object'
      AND jsonb_typeof(summary -> 'counts') = 'object'
      AND jsonb_typeof(summary -> 'limits') = 'object'
      AND jsonb_typeof(summary -> 'warnings') = 'array'
      AND jsonb_typeof(summary -> 'exclusions') = 'array'
      AND jsonb_typeof(summary -> 'artifact') = 'object'
      AND summary ->> 'packageId' IS NOT NULL
      AND summary ->> 'createdAt' IS NOT NULL
    )
  ) THEN
    RAISE EXCEPTION 'Malformed legacy governance export summary';
  END IF;
  IF EXISTS (
    SELECT 1 FROM governance_export_legacy_packages
    GROUP BY org_id, summary ->> 'packageId'
    HAVING count(DISTINCT summary::text) > 1
  ) THEN
    RAISE EXCEPTION 'Conflicting legacy governance export summaries';
  END IF;
END $$;

INSERT INTO governance_export_jobs (
  id, org_id, workspace_id, created_by, request, snapshot_at, state, percent,
  checkpoint, counts, limits, warnings, exclusions, lease_attempt, version,
  created_at, updated_at, completed_at
)
SELECT DISTINCT ON (org_id, summary ->> 'packageId')
  summary ->> 'packageId', org_id, summary #>> '{request,workspaceId}',
  'legacy_governance_export', summary -> 'request',
  (summary ->> 'createdAt')::timestamptz, 'artifact_ready', 100,
  jsonb_build_object(
    'datasetIndex', 0, 'partCount', 1,
    'processedRows', (
      SELECT coalesce(sum(value::bigint), 0)
      FROM jsonb_each_text(summary -> 'counts')
    ),
    'sizeBytes', (summary #>> '{artifact,sizeBytes}')::integer
  ),
  summary -> 'counts', summary -> 'limits', summary -> 'warnings',
  summary -> 'exclusions', 0, 1, (summary ->> 'createdAt')::timestamptz,
  (summary ->> 'createdAt')::timestamptz,
  (summary ->> 'createdAt')::timestamptz
FROM governance_export_legacy_packages
ON CONFLICT (org_id, id) DO NOTHING;

INSERT INTO governance_export_artifacts (
  id, job_id, org_id, object_key, content_type, file_name, size_bytes, sha256,
  part_count, created_at, expires_at
)
SELECT DISTINCT ON (legacy.org_id, legacy.summary ->> 'packageId')
  'artifact_' || (legacy.summary ->> 'packageId'),
  legacy.summary ->> 'packageId', legacy.org_id,
  'governance/data-exports/' || legacy.org_id || '/' ||
    (legacy.summary ->> 'packageId') || '.json',
  'application/json', (legacy.summary ->> 'packageId') || '.json',
  (legacy.summary #>> '{artifact,sizeBytes}')::integer,
  legacy.summary #>> '{artifact,sha256}', 1,
  (legacy.summary ->> 'createdAt')::timestamptz,
  (legacy.summary ->> 'createdAt')::timestamptz + interval '24 hours'
FROM governance_export_legacy_packages legacy
JOIN governance_export_jobs job
  ON job.org_id = legacy.org_id
  AND job.id = legacy.summary ->> 'packageId'
ON CONFLICT DO NOTHING;

DELETE FROM background_jobs
WHERE type = 'governance.data_export.package_artifact';
DELETE FROM system_settings
WHERE key LIKE 'governance.data_export_packages.%';

ALTER TABLE governance_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_export_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS romeo_tenant_isolation ON governance_export_jobs;
CREATE POLICY romeo_tenant_isolation ON governance_export_jobs
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

ALTER TABLE governance_export_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_export_artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS romeo_tenant_isolation ON governance_export_artifacts;
CREATE POLICY romeo_tenant_isolation ON governance_export_artifacts
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

GRANT SELECT, INSERT, UPDATE, DELETE ON governance_export_jobs
  TO romeo_tenant_runtime, romeo_system_coordinator;
GRANT SELECT, INSERT, UPDATE, DELETE ON governance_export_artifacts
  TO romeo_tenant_runtime, romeo_system_coordinator;
