ALTER TABLE "agent_versions"
  ADD COLUMN IF NOT EXISTS "capability_defaults" jsonb DEFAULT '[]'::jsonb NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_versions_capability_defaults_size_check'
  ) THEN
    ALTER TABLE "agent_versions"
      ADD CONSTRAINT "agent_versions_capability_defaults_size_check"
      CHECK (octet_length("capability_defaults"::text) <= 16384);
  END IF;
END $$;

ALTER TABLE "capability_assignments"
  DROP CONSTRAINT IF EXISTS "capability_assignment_scope_type_check";

ALTER TABLE "capability_assignments"
  ADD CONSTRAINT "capability_assignment_scope_type_check"
  CHECK ("scope_type" IN ('organization', 'workspace', 'agent', 'group', 'user'));
