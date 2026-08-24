ALTER TABLE object_records DROP CONSTRAINT IF EXISTS object_records_status_check;
ALTER TABLE object_records ADD CONSTRAINT object_records_status_check CHECK (
  status IN ('uploading','quarantined','scanning','extracting','transcoding','ready','attached','retained','failed','deletion_pending','deleted','available')
);

CREATE TABLE content_deletion_operations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id),
  workspace_id text NOT NULL REFERENCES workspaces(id),
  target_type text NOT NULL CHECK (target_type IN ('file_object','knowledge_source')),
  target_id text NOT NULL,
  target_generation text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','processing','failed','blocked','completed')),
  external_vector_verification_required boolean NOT NULL DEFAULT false,
  object_key text,
  knowledge_base_id text,
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('user','service_account')),
  requested_by_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  next_attempt_at timestamptz,
  failure_code text,
  legal_hold_evaluated_at timestamptz NOT NULL,
  object_deleted_at timestamptz,
  object_verified_at timestamptz,
  vectors_deleted_at timestamptz,
  vectors_verified_at timestamptz,
  relational_deleted_at timestamptz,
  attested_at timestamptz,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  lease_fence integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT content_deletion_operations_lease_check CHECK (
    (lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
    OR (lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX content_deletion_operations_org_idempotency_uidx
  ON content_deletion_operations (org_id, idempotency_key);
CREATE UNIQUE INDEX content_deletion_operations_active_target_uidx
  ON content_deletion_operations (org_id, target_type, target_id)
  WHERE status <> 'completed';
CREATE INDEX content_deletion_operations_claim_idx
  ON content_deletion_operations (
    org_id, status, next_attempt_at, lease_expires_at, created_at, id
  );

ALTER TABLE content_deletion_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_deletion_operations FORCE ROW LEVEL SECURITY;
CREATE POLICY romeo_tenant_isolation ON content_deletion_operations USING (
  pg_has_role(current_user, 'romeo_system_coordinator', 'member')
  OR (
    pg_has_role(current_user, 'romeo_tenant_runtime', 'member')
    AND org_id = nullif(current_setting('romeo.tenant_id', true), '')
  )
) WITH CHECK (
  pg_has_role(current_user, 'romeo_system_coordinator', 'member')
  OR (
    pg_has_role(current_user, 'romeo_tenant_runtime', 'member')
    AND org_id = nullif(current_setting('romeo.tenant_id', true), '')
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON content_deletion_operations
  TO romeo_tenant_runtime, romeo_system_coordinator;
