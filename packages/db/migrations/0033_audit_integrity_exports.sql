CREATE TABLE "audit_integrity_tenant_heads" (
	"org_id" text PRIMARY KEY NOT NULL,
	"last_sequence" bigint NOT NULL,
	"last_record_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_integrity_tenant_heads_sequence_check" CHECK ("last_sequence" > 0),
	CONSTRAINT "audit_integrity_tenant_heads_hash_shape_check" CHECK (char_length("last_record_hash") = 64)
);
--> statement-breakpoint
CREATE TABLE "audit_integrity_records" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"audit_event_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"previous_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"record_hash" text NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_integrity_records_sequence_check" CHECK ("sequence" > 0),
	CONSTRAINT "audit_integrity_records_hash_shape_check" CHECK (char_length("payload_hash") = 64 AND char_length("record_hash") = 64 AND ("previous_hash" = 'genesis' OR char_length("previous_hash") = 64))
);
--> statement-breakpoint
CREATE TABLE "audit_integrity_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"schema" text NOT NULL,
	"from_sequence" bigint NOT NULL,
	"to_sequence" bigint NOT NULL,
	"record_count" integer NOT NULL,
	"first_record_hash" text NOT NULL,
	"last_record_hash" text NOT NULL,
	"root_hash" text NOT NULL,
	"previous_checkpoint_hash" text NOT NULL,
	"algorithm" text NOT NULL,
	"key_version" text NOT NULL,
	"signature" text NOT NULL,
	"checkpoint_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_integrity_checkpoints_range_check" CHECK ("from_sequence" > 0 AND "to_sequence" >= "from_sequence" AND "record_count" = ("to_sequence" - "from_sequence" + 1)),
	CONSTRAINT "audit_integrity_checkpoints_algorithm_check" CHECK ("algorithm" IN ('hmac-sha256')),
	CONSTRAINT "audit_integrity_checkpoints_schema_check" CHECK ("schema" = 'romeo.audit-integrity-checkpoint.v1'),
	CONSTRAINT "audit_integrity_checkpoints_hash_shape_check" CHECK (char_length("first_record_hash") = 64 AND char_length("last_record_hash") = 64 AND char_length("root_hash") = 64 AND ("previous_checkpoint_hash" = 'genesis' OR char_length("previous_checkpoint_hash") = 64) AND char_length("signature") = 64 AND char_length("checkpoint_hash") = 64 AND char_length("key_version") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "audit_export_destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"config_reference" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"require_readback" boolean DEFAULT true NOT NULL,
	"require_retention_lock" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_export_destinations_kind_check" CHECK ("kind" IN ('customer_siem', 'worm_compatible')),
	CONSTRAINT "audit_export_destinations_config_reference_check" CHECK (char_length("config_reference") BETWEEN 1 AND 512)
);
--> statement-breakpoint
CREATE TABLE "audit_export_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"checkpoint_id" text NOT NULL,
	"checkpoint_hash" text NOT NULL,
	"from_sequence" bigint NOT NULL,
	"to_sequence" bigint NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"acknowledgement_hash" text,
	"destination_range_start" text,
	"destination_range_end" text,
	"readback_hash" text,
	"retention_lock_evidence" text,
	"last_error_code" text,
	"dead_letter_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "audit_export_jobs_range_check" CHECK ("from_sequence" > 0 AND "to_sequence" >= "from_sequence"),
	CONSTRAINT "audit_export_jobs_attempt_check" CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempt_count" <= "max_attempts"),
	CONSTRAINT "audit_export_jobs_status_check" CHECK ("status" IN ('queued', 'running', 'retry_scheduled', 'exported', 'dead_letter')),
	CONSTRAINT "audit_export_jobs_hash_shape_check" CHECK (char_length("checkpoint_hash") = 64 AND char_length("idempotency_key_hash") = 64 AND char_length("payload_hash") = 64 AND ("acknowledgement_hash" IS NULL OR char_length("acknowledgement_hash") = 64) AND ("readback_hash" IS NULL OR char_length("readback_hash") = 64))
);
--> statement-breakpoint
CREATE TABLE "audit_export_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"job_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"acknowledgement_hash" text,
	"destination_range_start" text,
	"destination_range_end" text,
	"readback_hash" text,
	"retention_lock_evidence" text,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "audit_export_attempts_status_check" CHECK ("status" IN ('failed', 'verified')),
	CONSTRAINT "audit_export_attempts_hash_shape_check" CHECK (("acknowledgement_hash" IS NULL OR char_length("acknowledgement_hash") = 64) AND ("readback_hash" IS NULL OR char_length("readback_hash") = 64))
);
--> statement-breakpoint
CREATE TABLE "audit_export_idempotency_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"job_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_export_idempotency_receipts_hash_shape_check" CHECK (char_length("idempotency_key_hash") = 64 AND char_length("request_hash") = 64)
);
--> statement-breakpoint
ALTER TABLE "audit_integrity_records" ADD CONSTRAINT "audit_integrity_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_integrity_tenant_heads" ADD CONSTRAINT "audit_integrity_tenant_heads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_integrity_records" ADD CONSTRAINT "audit_integrity_records_audit_event_id_audit_logs_id_fk" FOREIGN KEY ("audit_event_id") REFERENCES "public"."audit_logs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_integrity_checkpoints" ADD CONSTRAINT "audit_integrity_checkpoints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_destinations" ADD CONSTRAINT "audit_export_destinations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_jobs" ADD CONSTRAINT "audit_export_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_jobs" ADD CONSTRAINT "audit_export_jobs_destination_id_audit_export_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."audit_export_destinations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_jobs" ADD CONSTRAINT "audit_export_jobs_checkpoint_id_audit_integrity_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."audit_integrity_checkpoints"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_attempts" ADD CONSTRAINT "audit_export_attempts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_attempts" ADD CONSTRAINT "audit_export_attempts_job_id_audit_export_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."audit_export_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_idempotency_receipts" ADD CONSTRAINT "audit_export_idempotency_receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_export_idempotency_receipts" ADD CONSTRAINT "audit_export_idempotency_receipts_job_id_audit_export_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."audit_export_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_integrity_records_org_sequence_uidx" ON "audit_integrity_records" USING btree ("org_id", "sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_integrity_records_org_event_uidx" ON "audit_integrity_records" USING btree ("org_id", "audit_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_integrity_records_org_hash_uidx" ON "audit_integrity_records" USING btree ("org_id", "record_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_integrity_checkpoints_org_range_uidx" ON "audit_integrity_checkpoints" USING btree ("org_id", "from_sequence", "to_sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_integrity_checkpoints_org_hash_uidx" ON "audit_integrity_checkpoints" USING btree ("org_id", "checkpoint_hash");
--> statement-breakpoint
CREATE INDEX "audit_integrity_checkpoints_org_created_idx" ON "audit_integrity_checkpoints" USING btree ("org_id", "created_at", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_export_destinations_org_kind_uidx" ON "audit_export_destinations" USING btree ("org_id", "kind");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_export_jobs_org_idempotency_uidx" ON "audit_export_jobs" USING btree ("org_id", "idempotency_key_hash");
--> statement-breakpoint
CREATE INDEX "audit_export_jobs_due_idx" ON "audit_export_jobs" USING btree ("org_id", "status", "next_attempt_at", "created_at");
--> statement-breakpoint
CREATE INDEX "audit_export_jobs_destination_range_idx" ON "audit_export_jobs" USING btree ("org_id", "destination_id", "to_sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_export_attempts_job_attempt_uidx" ON "audit_export_attempts" USING btree ("job_id", "attempt");
--> statement-breakpoint
CREATE INDEX "audit_export_attempts_org_completed_idx" ON "audit_export_attempts" USING btree ("org_id", "completed_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "audit_export_idempotency_receipts_org_key_uidx" ON "audit_export_idempotency_receipts" USING btree ("org_id", "idempotency_key_hash");
--> statement-breakpoint
CREATE FUNCTION "romeo_protect_audit_integrity_row"() RETURNS trigger AS $$
BEGIN
	IF current_setting('romeo.audit_integrity_mutation', true) IS DISTINCT FROM 'authorized' THEN
		RAISE EXCEPTION 'audit integrity rows are immutable';
	END IF;
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audit_integrity_records_immutable" BEFORE UPDATE OR DELETE ON "audit_integrity_records" FOR EACH ROW EXECUTE FUNCTION "romeo_protect_audit_integrity_row"();
--> statement-breakpoint
CREATE TRIGGER "audit_integrity_checkpoints_immutable" BEFORE UPDATE OR DELETE ON "audit_integrity_checkpoints" FOR EACH ROW EXECUTE FUNCTION "romeo_protect_audit_integrity_row"();
