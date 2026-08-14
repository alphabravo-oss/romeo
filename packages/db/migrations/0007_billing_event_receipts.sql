CREATE TABLE "billing_event_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_event_receipts" ADD CONSTRAINT "billing_event_receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "billing_event_receipt_provider_event_idx" ON "billing_event_receipts" USING btree ("org_id","provider","event_id");
--> statement-breakpoint
CREATE INDEX "billing_event_receipt_occurred_idx" ON "billing_event_receipts" USING btree ("org_id","occurred_at");
