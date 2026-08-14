ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "webhook_deliveries_org_created_idx";--> statement-breakpoint
CREATE INDEX "webhook_deliveries_org_created_idx" ON "webhook_deliveries" USING btree ("org_id","created_at" DESC NULLS LAST,"id" ASC NULLS LAST);--> statement-breakpoint
DROP INDEX IF EXISTS "webhook_deliveries_subscription_created_idx";--> statement-breakpoint
CREATE INDEX "webhook_deliveries_subscription_created_idx" ON "webhook_deliveries" USING btree ("org_id","subscription_id","created_at" DESC NULLS LAST,"id" ASC NULLS LAST);--> statement-breakpoint
DROP INDEX IF EXISTS "webhook_deliveries_retry_due_idx";--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_due_idx" ON "webhook_deliveries" USING btree ("org_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_lease_idx" ON "webhook_deliveries" USING btree ("org_id","status","lease_expires_at");
