DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'run_events_reasoning_summary_shape_check'
      AND conrelid = 'run_events'::regclass
  ) THEN
    ALTER TABLE "run_events"
      ADD CONSTRAINT "run_events_reasoning_summary_shape_check"
      CHECK (
        "type" NOT IN ('reasoning.summary.delta', 'reasoning.summary.completed')
        OR (
          jsonb_typeof("data") = 'object'
          AND octet_length("data"::text) <= 24576
          AND (
            (
              "type" = 'reasoning.summary.delta'
              AND "data" ?& ARRAY['classification', 'contentPolicyApplied', 'text']
              AND "data" - 'classification' - 'contentPolicyApplied' - 'text' = '{}'::jsonb
              AND "data"->>'classification' = 'provider_safe_summary'
              AND "data"->'contentPolicyApplied' = 'true'::jsonb
              AND jsonb_typeof("data"->'text') = 'string'
              AND char_length("data"->>'text') <= 4096
            )
            OR (
              "type" = 'reasoning.summary.completed'
              AND "data" ?& ARRAY['classification', 'status']
              AND "data" - 'classification' - 'status' - 'characterCount' - 'durationMs' - 'reasoningTokens' = '{}'::jsonb
              AND (
                (
                  "data"->>'classification' = 'provider_safe_summary'
                  AND "data"->>'status' = 'completed'
                )
                OR (
                  "data"->>'classification' = 'hidden_reasoning_omitted'
                  AND "data"->>'status' = 'discarded'
                  AND NOT ("data" ? 'characterCount')
                )
              )
              AND CASE WHEN "data" ? 'characterCount' THEN
                CASE WHEN jsonb_typeof("data"->'characterCount') = 'number' THEN
                  ("data"->>'characterCount')::numeric BETWEEN 0 AND 20000
                  AND mod(("data"->>'characterCount')::numeric, 1) = 0
                ELSE false END
              ELSE true END
              AND CASE WHEN "data" ? 'durationMs' THEN
                CASE WHEN jsonb_typeof("data"->'durationMs') = 'number' THEN
                  ("data"->>'durationMs')::numeric BETWEEN 0 AND 86400000
                  AND mod(("data"->>'durationMs')::numeric, 1) = 0
                ELSE false END
              ELSE true END
              AND CASE WHEN "data" ? 'reasoningTokens' THEN
                CASE WHEN jsonb_typeof("data"->'reasoningTokens') = 'number' THEN
                  ("data"->>'reasoningTokens')::numeric BETWEEN 0 AND 200000
                  AND mod(("data"->>'reasoningTokens')::numeric, 1) = 0
                ELSE false END
              ELSE true END
            )
          )
        )
      ) NOT VALID;
  END IF;
END $$;
