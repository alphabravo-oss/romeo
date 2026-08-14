CREATE TABLE "saml_auth_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"relay_state_hash" text NOT NULL,
	"request_instant" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saml_auth_requests" ADD CONSTRAINT "saml_auth_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "saml_auth_requests_expiry_idx" ON "saml_auth_requests" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "saml_auth_requests_org_idx" ON "saml_auth_requests" USING btree ("org_id","created_at");
