-- Composite tenant keys make every run/job binding tenant-consistent at the
-- database boundary. The globally unique primary keys remain unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS runs_org_id_id_uidx
  ON runs (org_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS background_jobs_org_id_id_uidx
  ON background_jobs (org_id, id);

CREATE TABLE IF NOT EXISTS content_policy_decisions (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id),
  policy_version_id text NOT NULL,
  surface text NOT NULL,
  action text NOT NULL,
  detectors jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_id text,
  execution_job_id text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_policy_decisions_pkey PRIMARY KEY (org_id, id),
  CONSTRAINT content_policy_decisions_org_run_fk
    FOREIGN KEY (org_id, run_id) REFERENCES runs(org_id, id),
  CONSTRAINT content_policy_decisions_org_job_fk
    FOREIGN KEY (org_id, execution_job_id)
    REFERENCES background_jobs(org_id, id),
  CONSTRAINT content_policy_decisions_action_check
    CHECK (action IN ('allow', 'audit', 'redact', 'block'))
);

CREATE INDEX IF NOT EXISTS content_policy_decisions_org_decided_idx
  ON content_policy_decisions (org_id, decided_at, id);
CREATE INDEX IF NOT EXISTS content_policy_decisions_org_run_idx
  ON content_policy_decisions (org_id, run_id);

CREATE TABLE IF NOT EXISTS content_policy_approvals (
  id text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id),
  run_id text NOT NULL,
  decision_id text NOT NULL,
  policy_version_id text NOT NULL,
  execution_job_id text,
  actor_id text NOT NULL,
  state text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  CONSTRAINT content_policy_approvals_pkey PRIMARY KEY (org_id, id),
  CONSTRAINT content_policy_approvals_org_decision_fk
    FOREIGN KEY (org_id, decision_id)
    REFERENCES content_policy_decisions(org_id, id),
  CONSTRAINT content_policy_approvals_org_run_fk
    FOREIGN KEY (org_id, run_id) REFERENCES runs(org_id, id),
  CONSTRAINT content_policy_approvals_org_job_fk
    FOREIGN KEY (org_id, execution_job_id)
    REFERENCES background_jobs(org_id, id),
  CONSTRAINT content_policy_approvals_state_check
    CHECK (state IN ('pending', 'approved', 'denied', 'expired')),
  CONSTRAINT content_policy_approvals_resolution_check CHECK (
    (state = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (state <> 'pending' AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT content_policy_approvals_pending_job_check
    CHECK (state <> 'pending' OR execution_job_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS content_policy_approvals_org_decision_uidx
  ON content_policy_approvals (org_id, decision_id);
CREATE INDEX IF NOT EXISTS content_policy_approvals_org_state_expiry_idx
  ON content_policy_approvals (org_id, state, expires_at, id);
CREATE INDEX IF NOT EXISTS content_policy_approvals_org_run_idx
  ON content_policy_approvals (org_id, run_id);

DO $validate_legacy_content_policy$
DECLARE
  malformed_count bigint;
  malformed_key_hashes text;
BEGIN
  SELECT count(*) INTO malformed_count
  FROM system_settings
  WHERE (
    key LIKE 'content_policy.decisions.v1:%'
    AND (
      value ->> 'schema' IS DISTINCT FROM 'romeo.content-policy.decisions.v1'
      OR jsonb_typeof(value -> 'decisions') IS DISTINCT FROM 'array'
    )
  ) OR (
    key LIKE 'content_policy.approvals.v1:%'
    AND (
      value ->> 'schema' IS DISTINCT FROM 'romeo.content-policy.approvals.v1'
      OR jsonb_typeof(value -> 'approvals') IS DISTINCT FROM 'array'
    )
  );

  SELECT string_agg(key_hash, ',' ORDER BY key_hash)
  INTO malformed_key_hashes
  FROM (
    SELECT md5(key) AS key_hash
    FROM system_settings
    WHERE (
      key LIKE 'content_policy.decisions.v1:%'
      AND (
        value ->> 'schema' IS DISTINCT FROM 'romeo.content-policy.decisions.v1'
        OR jsonb_typeof(value -> 'decisions') IS DISTINCT FROM 'array'
      )
    ) OR (
      key LIKE 'content_policy.approvals.v1:%'
      AND (
        value ->> 'schema' IS DISTINCT FROM 'romeo.content-policy.approvals.v1'
        OR jsonb_typeof(value -> 'approvals') IS DISTINCT FROM 'array'
      )
    )
    LIMIT 20
  ) malformed;

  IF malformed_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'migration 0039 cannot normalize %s malformed content-policy setting row(s); key_md5=%s',
        malformed_count,
        coalesce(malformed_key_hashes, '')
      );
  END IF;
END $validate_legacy_content_policy$;

INSERT INTO content_policy_decisions (
  id,
  org_id,
  policy_version_id,
  surface,
  action,
  detectors,
  decided_at
)
SELECT
  decision ->> 'id',
  setting.org_id,
  decision ->> 'versionId',
  decision ->> 'surface',
  decision ->> 'action',
  coalesce(decision -> 'detectors', '[]'::jsonb),
  (decision ->> 'decidedAt')::timestamptz
FROM system_settings setting
CROSS JOIN LATERAL jsonb_array_elements(setting.value -> 'decisions') decision
WHERE setting.key LIKE 'content_policy.decisions.v1:%'
  AND setting.org_id IS NOT NULL
ON CONFLICT (org_id, id) DO NOTHING;

-- The retired public request endpoint allowed unbound approval IDs. Preserve
-- those records as inert history without ever making them executable.
INSERT INTO content_policy_decisions (
  id,
  org_id,
  policy_version_id,
  surface,
  action,
  detectors,
  decided_at
)
SELECT DISTINCT ON (setting.org_id, approval ->> 'decisionId')
  approval ->> 'decisionId',
  setting.org_id,
  'legacy_unbound',
  'legacy_approval',
  'block',
  '[]'::jsonb,
  (approval ->> 'createdAt')::timestamptz
FROM system_settings setting
CROSS JOIN LATERAL jsonb_array_elements(setting.value -> 'approvals') approval
WHERE setting.key LIKE 'content_policy.approvals.v1:%'
  AND setting.org_id IS NOT NULL
ON CONFLICT (org_id, id) DO NOTHING;

INSERT INTO content_policy_approvals (
  id,
  org_id,
  run_id,
  decision_id,
  policy_version_id,
  actor_id,
  state,
  expires_at,
  created_at,
  resolved_at,
  resolved_by
)
SELECT
  approval ->> 'id',
  setting.org_id,
  approval ->> 'runId',
  approval ->> 'decisionId',
  decision.policy_version_id,
  approval ->> 'actorId',
  CASE
    WHEN approval ->> 'state' IN ('approved', 'denied', 'expired')
      THEN approval ->> 'state'
    ELSE 'expired'
  END,
  (approval ->> 'expiresAt')::timestamptz,
  (approval ->> 'createdAt')::timestamptz,
  coalesce((approval ->> 'resolvedAt')::timestamptz, now()),
  approval ->> 'resolvedBy'
FROM system_settings setting
CROSS JOIN LATERAL jsonb_array_elements(setting.value -> 'approvals') approval
JOIN content_policy_decisions decision
  ON decision.org_id = setting.org_id
  AND decision.id = approval ->> 'decisionId'
JOIN runs run
  ON run.org_id = setting.org_id
  AND run.id = approval ->> 'runId'
WHERE setting.key LIKE 'content_policy.approvals.v1:%'
  AND setting.org_id IS NOT NULL
ON CONFLICT (org_id, id) DO NOTHING;

-- Never delete a legacy setting unless every element has a corresponding
-- normalized row. This also catches duplicate/conflicting identifiers and
-- orphan run references. Diagnostics disclose only setting-key digests.
DO $verify_normalized_content_policy$
DECLARE
  unresolved_count bigint;
  unresolved_key_hashes text;
BEGIN
  WITH unresolved AS (
    SELECT setting.key
    FROM system_settings setting
    CROSS JOIN LATERAL jsonb_array_elements(setting.value -> 'decisions') item
    WHERE setting.key LIKE 'content_policy.decisions.v1:%'
      AND NOT EXISTS (
        SELECT 1
        FROM content_policy_decisions decision
        WHERE decision.org_id = setting.org_id
          AND decision.id = item ->> 'id'
          AND decision.policy_version_id = item ->> 'versionId'
          AND decision.surface = item ->> 'surface'
          AND decision.action = item ->> 'action'
          AND decision.detectors = coalesce(item -> 'detectors', '[]'::jsonb)
          AND decision.decided_at = (item ->> 'decidedAt')::timestamptz
      )
    UNION ALL
    SELECT setting.key
    FROM system_settings setting
    CROSS JOIN LATERAL jsonb_array_elements(setting.value -> 'approvals') item
    WHERE setting.key LIKE 'content_policy.approvals.v1:%'
      AND NOT EXISTS (
        SELECT 1
        FROM content_policy_approvals approval
        WHERE approval.org_id = setting.org_id
          AND approval.id = item ->> 'id'
          AND approval.run_id = item ->> 'runId'
          AND approval.decision_id = item ->> 'decisionId'
          AND approval.actor_id = item ->> 'actorId'
      )
  )
  SELECT count(*), (
    SELECT string_agg(key_hash, ',' ORDER BY key_hash)
    FROM (
      SELECT DISTINCT md5(key) AS key_hash
      FROM unresolved
      LIMIT 20
    ) hashed
  )
  INTO unresolved_count, unresolved_key_hashes
  FROM unresolved;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = format(
        'migration 0039 refused to retire %s unnormalized content-policy element(s); key_md5=%s',
        unresolved_count,
        coalesce(unresolved_key_hashes, '')
      );
  END IF;
END $verify_normalized_content_policy$;

DELETE FROM system_settings
WHERE key LIKE 'content_policy.decisions.v1:%'
   OR key LIKE 'content_policy.approvals.v1:%';

ALTER TABLE content_policy_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_policy_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS romeo_tenant_isolation ON content_policy_decisions;
CREATE POLICY romeo_tenant_isolation ON content_policy_decisions
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

ALTER TABLE content_policy_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_policy_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS romeo_tenant_isolation ON content_policy_approvals;
CREATE POLICY romeo_tenant_isolation ON content_policy_approvals
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

GRANT SELECT, INSERT, UPDATE, DELETE ON content_policy_decisions
  TO romeo_tenant_runtime, romeo_system_coordinator;
GRANT SELECT, INSERT, UPDATE, DELETE ON content_policy_approvals
  TO romeo_tenant_runtime, romeo_system_coordinator;
