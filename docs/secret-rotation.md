# Secret Rotation Runbook

Romeo treats deployment secrets as platform-managed values. Do not paste raw secret values into tickets, audit notes, release evidence, or support bundles.

## Session And OIDC PKCE Secrets

`SESSION_SECRET` signs short-lived OIDC PKCE state cookies. Local app sessions use opaque `rms_` tokens hashed in the database, so rotating `SESSION_SECRET` does not invalidate existing local sessions by itself.

Staged rotation:

1. Generate a new high-entropy `SESSION_SECRET`.
2. Set `SESSION_SECRET_PREVIOUS` to the old `SESSION_SECRET`.
3. Set `SESSION_SECRET` to the new value.
4. Restart or roll app pods/containers.
5. Verify `/api/v1/admin/readiness` is `ready`; the `session_secret_previous` check should pass with `mode: "dual_read_oidc_pkce_only"`.
6. Wait longer than the OIDC PKCE state TTL, currently 10 minutes.
7. Remove `SESSION_SECRET_PREVIOUS` and roll app pods/containers again.

To invalidate existing app sessions, revoke sessions or API keys explicitly. Do not rely on `SESSION_SECRET` rotation for local-session revocation.

## Local MFA Secret Encryption Key

`LOCAL_AUTH_SECRET_ENCRYPTION_KEY` encrypts local MFA envelopes, including TOTP secrets and recovery-code hash envelopes. Set it before enabling local MFA in shared environments and keep it in the same secret-management tier as `SESSION_SECRET` and `WEBHOOK_SIGNING_KEY`.

Staged rewrap:

1. Generate a new high-entropy `LOCAL_AUTH_SECRET_ENCRYPTION_KEY`.
2. Set `LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS` to the old key and set `LOCAL_AUTH_SECRET_ENCRYPTION_KEY` to the new key.
3. Restart or roll app pods/containers.
4. Call `POST /api/v1/admin/secret-rotation/rewrap/preview` and verify `localMfa.status` has zero failures in the returned report.
5. Call `POST /api/v1/admin/secret-rotation/rewrap` with `{ "confirmRewrap": "rewrap-secret-envelopes" }`.
6. Verify the report shows the expected local MFA `rewrappedCount`, `failedCount: 0`, and redaction flags set to false for returned TOTP secrets, recovery-code values, and key material.
7. Remove `LOCAL_AUTH_SECRET_ENCRYPTION_KEY_PREVIOUS` and roll app pods/containers again.

The rewrap endpoint uses the previous key only to decrypt existing envelopes and writes new envelopes with the active key. It returns counts, failure codes, and redaction posture only; it does not return factor IDs, user emails, TOTP secrets, recovery-code values, or key material.

## Locally Managed Secret Encryption Key

`MANAGED_SECRET_ENCRYPTION_KEY` encrypts local `romeo-secret://` envelopes created through `POST /api/v1/admin/secrets`. Vault-backed `vault://` refs and externally managed refs are rotated in their backing secret manager instead.

Staged rewrap follows the same pattern as local MFA:

1. Generate a new high-entropy `MANAGED_SECRET_ENCRYPTION_KEY`.
2. Set `MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS` to the old key and set `MANAGED_SECRET_ENCRYPTION_KEY` to the new key.
3. Restart or roll app pods/containers.
4. Call `POST /api/v1/admin/secret-rotation/rewrap/preview` and verify the `managedSecrets` section has zero failures.
5. Call `POST /api/v1/admin/secret-rotation/rewrap` with `{ "confirmRewrap": "rewrap-secret-envelopes" }`. Global managed-secret envelopes require a global admin and `includeGlobalManagedSecrets: true`.
6. Verify the report shows expected managed-secret `rewrappedCount`, `failedCount: 0`, and redaction flags set to false for returned secret refs and values.
7. Remove `MANAGED_SECRET_ENCRYPTION_KEY_PREVIOUS` and roll app pods/containers again.

Record only key-reference names, report counts, failure codes, and rollout timestamps. Never record old/new key values, `romeo-secret://` refs, local TOTP secrets, recovery-code values, or managed secret values in tickets, logs, or evidence.

## Target Evidence And Readback

After a reviewed Kubernetes or production-like target rotation has completed, record metadata-only evidence:

```sh
pnpm evidence:secret-rotation-drill -- --output dist/ci/secret-rotation-drill-evidence.json
```

Review the generated file, mount it read-only, and set `SECRET_ROTATION_DRILL_EVIDENCE_PATH`. Admins can then read `GET /api/v1/admin/secret-rotation/drill-posture` or `client.admin.secretRotationDrillPosture()` for staged-cutover posture, rewrap counts, old/new secret acceptance counts, dependency credential review, readiness, alerting, warning codes, and redaction booleans. The posture API does not return mounted paths, evidence bodies, secret refs, secret values, tokens, API keys, key material, webhook signing secrets, or raw log lines.

## Webhook Signing Key

`WEBHOOK_SIGNING_KEY` derives one-time outbound webhook subscription secrets. Romeo does not persist raw subscription secrets, and list APIs do not return them.

Rotation has subscriber impact: changing `WEBHOOK_SIGNING_KEY` changes the derived signing secret for existing subscriptions. Coordinate one of these patterns:

- Create replacement webhook subscriptions and share their one-time `whsec_` values with subscribers before disabling old subscriptions.
- Schedule a maintenance window where subscribers update verification secrets at the same time as Romeo rolls the new `WEBHOOK_SIGNING_KEY`.

Do not record old or new `WEBHOOK_SIGNING_KEY` values in evidence. Record only timestamps, subscription IDs, and subscriber acknowledgement state.

## Compose Validation

Before changing this runbook or accepting a Compose deployment rotation procedure, run:

```sh
pnpm smoke:compose:secret-rotation
```

The smoke uses generated secrets in a temporary project, stages `SESSION_SECRET_PREVIOUS`, verifies admin readiness and API-key continuity after rotation, verifies newly created webhook subscriptions derive a different one-time signing secret after `WEBHOOK_SIGNING_KEY` changes, removes `SESSION_SECRET_PREVIOUS`, and scans captured Compose logs for the generated old/new secrets and one-time webhook secrets.

## API Keys And Service Keys

API keys and service-account keys are independently hashed and revocable:

1. Create a replacement key with the minimum required scopes.
2. Deploy the replacement key to workers or clients.
3. Confirm successful readiness, worker, or client operation.
4. Revoke the old key.
5. Verify old-key requests return `401`.

## Database, Object Store, Provider, And Connector Secrets

- Database credentials: rotate at the database or hosted provider, update `DATABASE_URL`, restart app and workers, then run readiness and schema validation.
- S3/RustFS credentials: rotate in the object store, update deployment secrets, restart app and backup/restore workers, then verify artifact readback and backup dry-run evidence.
- Provider keys: update the provider-specific secret in the platform secret manager, restart only the workloads that read it, then run a provider/model readiness check.
- Connector secrets: prefer managed refs such as `vault://`, `external-secret://`, `aws-sm://`, `gcp-sm://`, `azure-kv://`, or reviewed `env://` refs. Rotate at the secret backend and verify connector auth checks without exposing values.

## Evidence

Acceptable evidence:

- Readiness report status and check IDs.
- Key IDs, subscription IDs, or secret reference names.
- Rotation timestamps and rollout IDs.
- Redacted log scans.

Rejected evidence:

- Raw secret values.
- Database URLs with passwords.
- Bearer tokens, session cookies, API keys, or webhook signing secrets.
