-- Expand: bound local MFA guessing and reject TOTP replay.
-- Each MFA challenge records how many verification attempts it has served so
-- it can be invalidated after a small budget. The password credential tracks
-- consecutive MFA failures independently of password failures so minting a
-- new challenge with the password does not reset the lockout budget. TOTP
-- factors remember the last accepted time-step so a code cannot be reused.
ALTER TABLE "local_mfa_challenges"
  ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "local_password_credentials"
  ADD COLUMN IF NOT EXISTS "mfa_failed_attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "local_mfa_factors"
  ADD COLUMN IF NOT EXISTS "last_totp_step" bigint;
