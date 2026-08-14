ALTER TABLE "runs" ADD COLUMN "next_event_sequence" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run_events" ALTER COLUMN "sequence" SET DATA TYPE bigint;--> statement-breakpoint
UPDATE "runs"
SET "next_event_sequence" = COALESCE(
  (
    SELECT MAX("run_events"."sequence")
    FROM "run_events"
    WHERE "run_events"."run_id" = "runs"."id"
  ),
  0
);
