ALTER TABLE "webhook_deliveries"
  ADD COLUMN IF NOT EXISTS "signature_key_version" text;
