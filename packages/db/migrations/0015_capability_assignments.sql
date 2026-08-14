CREATE TABLE "capability_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"state" text NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" bigint NOT NULL,
	"supersedes_id" text,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_assignment_scope_type_check" CHECK ("scope_type" in ('organization', 'workspace')),
	CONSTRAINT "capability_assignment_state_check" CHECK ("state" in ('inherit', 'enabled', 'disabled', 'required')),
	CONSTRAINT "capability_assignment_version_check" CHECK ("version" > 0),
	CONSTRAINT "capability_assignment_expiry_check" CHECK ("expires_at" is null or "expires_at" > "effective_at"),
	CONSTRAINT "capability_assignment_effective_time_check" CHECK ("effective_at" <= "created_at"),
	CONSTRAINT "capability_assignment_config_size_check" CHECK (octet_length("configuration"::text) <= 16384),
	CONSTRAINT "capability_assignment_reason_check" CHECK (char_length("reason") between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "capability_assignments" ADD CONSTRAINT "capability_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "capability_assignments" ADD CONSTRAINT "capability_assignments_supersedes_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."capability_assignments"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_assignment_active_unique_idx" ON "capability_assignments" USING btree ("org_id","scope_type","scope_id","capability_id") WHERE "revoked_at" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX "capability_assignment_version_unique_idx" ON "capability_assignments" USING btree ("org_id","scope_type","scope_id","capability_id","version");
--> statement-breakpoint
CREATE INDEX "capability_assignment_effective_lookup_idx" ON "capability_assignments" USING btree ("org_id","scope_type","scope_id","capability_id","effective_at");
--> statement-breakpoint
CREATE INDEX "capability_assignment_history_idx" ON "capability_assignments" USING btree ("org_id","scope_type","scope_id","capability_id","version");
