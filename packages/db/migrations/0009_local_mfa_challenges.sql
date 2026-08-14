CREATE TABLE "local_mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "local_mfa_challenges" ADD CONSTRAINT "local_mfa_challenges_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "local_mfa_challenges" ADD CONSTRAINT "local_mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "local_mfa_challenges_expiry_idx" ON "local_mfa_challenges" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "local_mfa_challenges_user_idx" ON "local_mfa_challenges" USING btree ("org_id","user_id","created_at");
