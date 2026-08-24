DO $$
BEGIN
  IF to_regclass('public.workflow_definitions') IS NOT NULL THEN
    COMMENT ON TABLE "workflow_definitions" IS
      'Retired Romeo workflow definitions retained for compatibility, export, legal hold, and governed data lifecycle processing.';
  END IF;

  IF to_regclass('public.workflow_runs') IS NOT NULL THEN
    COMMENT ON TABLE "workflow_runs" IS
      'Retired Romeo workflow run history retained for compatibility, export, legal hold, and governed data lifecycle processing.';
  END IF;
END
$$;
