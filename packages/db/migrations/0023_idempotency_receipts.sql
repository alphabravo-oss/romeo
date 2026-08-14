CREATE TABLE IF NOT EXISTS "idempotency_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL REFERENCES "organizations"("id"),
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "credential_hash" text NOT NULL,
  "operation" text NOT NULL,
  "key_hash" text NOT NULL,
  "request_hash" text NOT NULL,
  "state" text NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "response_status" integer,
  "response_body" jsonb,
  "error_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "idempotency_receipt_actor_type_check" CHECK ("actor_type" IN ('user', 'service_account')),
  CONSTRAINT "idempotency_receipt_state_check" CHECK ("state" IN ('in_progress', 'completed', 'failed')),
  CONSTRAINT "idempotency_receipt_key_hash_check" CHECK (char_length("key_hash") = 64),
  CONSTRAINT "idempotency_receipt_request_hash_check" CHECK (char_length("request_hash") = 64),
  CONSTRAINT "idempotency_receipt_credential_hash_check" CHECK (char_length("credential_hash") = 64),
  CONSTRAINT "idempotency_receipt_response_size_check" CHECK ("response_body" IS NULL OR octet_length("response_body"::text) <= 131072)
);

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_receipt_scope_unique_idx"
  ON "idempotency_receipts" ("org_id", "actor_type", "actor_id", "credential_hash", "operation", "key_hash");
CREATE INDEX IF NOT EXISTS "idempotency_receipt_expiry_idx"
  ON "idempotency_receipts" ("expires_at", "id");
CREATE INDEX IF NOT EXISTS "idempotency_receipt_lease_idx"
  ON "idempotency_receipts" ("state", "lease_expires_at");
