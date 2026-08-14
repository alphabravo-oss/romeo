ALTER TABLE "eval_runs"
  ADD COLUMN IF NOT EXISTS "reasoning_policy" jsonb,
  ADD COLUMN IF NOT EXISTS "metrics" jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eval_runs_reasoning_policy_shape_check'
      AND conrelid = 'eval_runs'::regclass
  ) THEN
    ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_reasoning_policy_shape_check"
      CHECK (
        "reasoning_policy" IS NULL OR (
          jsonb_typeof("reasoning_policy") = 'object'
          AND "reasoning_policy" ?& ARRAY['requested', 'effective']
          AND "reasoning_policy" - 'requested' - 'effective' = '{}'::jsonb
          AND jsonb_typeof("reasoning_policy"->'requested') = 'object'
          AND jsonb_typeof("reasoning_policy"->'effective') = 'object'
          AND octet_length("reasoning_policy"::text) <= 4096
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'eval_runs_metrics_shape_check'
      AND conrelid = 'eval_runs'::regclass
  ) THEN
    ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_metrics_shape_check"
      CHECK (
        "metrics" IS NULL OR (
          jsonb_typeof("metrics") = 'object'
          AND "metrics" ?& ARRAY['latencyMs', 'usage', 'costBasis']
          AND "metrics" - 'latencyMs' - 'usage' - 'costBasis' - 'estimatedCostUsd' = '{}'::jsonb
          AND jsonb_typeof("metrics"->'latencyMs') = 'number'
          AND jsonb_typeof("metrics"->'usage') = 'object'
          AND "metrics"->'usage' ? 'coverage'
          AND ("metrics"->>'costBasis') IN ('reported_tokens', 'unavailable')
          AND octet_length("metrics"::text) <= 4096
        )
      );
  END IF;
END $$;
