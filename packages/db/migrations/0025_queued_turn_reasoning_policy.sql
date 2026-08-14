ALTER TABLE "queued_chat_turns"
  ADD COLUMN IF NOT EXISTS "reasoning_policy" jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'queued_chat_turn_reasoning_policy_size_check'
  ) THEN
    ALTER TABLE "queued_chat_turns"
      ADD CONSTRAINT "queued_chat_turn_reasoning_policy_size_check"
      CHECK (
        "reasoning_policy" IS NULL OR (
          jsonb_typeof("reasoning_policy") = 'object'
          AND octet_length("reasoning_policy"::text) <= 4096
        )
      );
  END IF;
END $$;
