# Private and Air-Gapped Deployment

Romeo can run in private networks when release artifacts, images, object storage, model endpoints, and secrets are mirrored inside the environment.

## Release Inputs

Build and archive these artifacts before crossing the boundary:

```sh
pnpm verify
pnpm release:pack
pnpm run sbom:generate -- --output dist/release/sbom.cdx.json
pnpm release:channel -- --manifest dist/release/release-manifest.json --output dist/release/release-channel.json
pnpm containers:scan-plan -- --scanner trivy --output dist/release/container-scan-plan.json
pnpm release:security -- --manifest dist/release/release-manifest.json --sbom dist/release/sbom.cdx.json
pnpm release:provenance -- --manifest dist/release/release-manifest.json --channel-file dist/release/release-channel.json --security-evidence dist/release/security-evidence.json --sbom dist/release/sbom.cdx.json --commit-sha "$GIT_COMMIT_SHA" --source-repo "$SOURCE_REPOSITORY" --source-ref "$SOURCE_REF" --builder-id "$CI_BUILDER_ID" --ci-run-url "$CI_RUN_URL" --output dist/release/release-provenance.json
pnpm release:approval -- --manifest dist/release/release-manifest.json --provenance-file dist/release/release-provenance.json --approval-ref "$RELEASE_APPROVAL_REF" --approver-id "$RELEASE_APPROVER_ID_1" --approver-id "$RELEASE_APPROVER_ID_2" --approved-at "$RELEASE_APPROVED_AT" --expires-at "$RELEASE_APPROVAL_EXPIRES_AT" --output dist/release/release-approval.json
pnpm release:upgrade-check -- --channel-file dist/release/release-channel.json
pnpm release:publish-plan -- --manifest dist/release/release-manifest.json --channel-file dist/release/release-channel.json --security-evidence dist/release/security-evidence.json --provenance-file dist/release/release-provenance.json --approval-file dist/release/release-approval.json --require-provenance --require-approval --output dist/release/publish-plan.json
pnpm release:airgap-check -- --bundle-dir dist/release --publish-plan publish-plan.json --require-publish-plan --require-approval --output dist/release/airgap-bundle-verification.json
```

After staging publish and protected approval, generate `release-readback.json` and `readback-validation.json` with the credentialed package/image/chart/release-asset commands in [GA Evidence](./ga-evidence.md). Generate `ga-evidence-bundle.json` with `--readback-validation dist/release/readback-validation.json --require-readback-validation` once the validation passes.

Mirror the generated tarballs, `release-manifest.json`, `release-channel.json`, `container-scan-plan.json`, `security-evidence.json`, `release-provenance.json`, `release-approval.json`, `release-readback.json`, `readback-validation.json`, `upgrade-validation.json`, `publish-plan.json`, `ga-evidence-bundle.json`, `airgap-bundle-verification.json`, and `sbom.cdx.json` into the private package registry or artifact repository. Keep the SDK publish order from the manifest: publish `@romeo/api-client` before `@romeo/cli`.

Run `pnpm release:airgap-check` again after the mirror copy, pointing `--bundle-dir` at the mirrored bundle. For final GA promotion, include `ga-evidence-bundle.json`, `release-readback.json`, and `readback-validation.json` in the mirrored release directory and add `--ga-bundle ga-evidence-bundle.json --require-ga-bundle --release-readback release-readback.json --require-release-readback --readback-validation readback-validation.json --require-readback-validation --require-approval`; add `--require-signed-provenance` when the deployment requires signature or attestation evidence. The generated `romeo.airgap-bundle-verification.v1` evidence stores only file names, byte counts, hashes, schema/status summaries, blocker codes, and redaction flags.

If vulnerability scanning must run entirely outside the connected build host, run the commands from `container-scan-plan.json` inside the private environment, export scanner JSON there, and regenerate security evidence with `--audit-file` and repeated `--container-scan-file` arguments.

## Runtime Dependencies

Provision these services inside the private network:

- Postgres with the `vector` extension enabled before the baseline schema is applied.
- Valkey.
- S3-compatible object storage such as RustFS or an internal S3 service.
- A private container registry for Romeo images.
- An internal model endpoint, either OpenAI-compatible or Ollama.
- A secret manager or injected environment secret source.

Romeo UI and API docs must not depend on external CDNs. Keep `/api/v1/docs` self-contained and serve static assets from the app image.

## Network Policy

Default to deny egress from app and worker workloads. Explicitly allow:

- Postgres, Valkey, and object storage endpoints.
- Internal model provider endpoints.
- Approved connector hosts only when connector execution is enabled.
- Approved webhook receivers only when outbound webhooks are used.

Keep `DATA_CONNECTOR_EXECUTION_DRIVER=disabled` unless connector egress has been reviewed. When website, RSS, Confluence, Jira, Notion, Linear, or Slack fetches are enabled, set `DATA_CONNECTOR_EGRESS_POLICY=require_allowlist`, set `DATA_CONNECTOR_FETCH_ALLOWED_HOSTS`, and keep fetch byte/timeout limits bounded. When GitHub fetches are enabled, mirror GitHub Enterprise or approve `api.github.com` egress and inject deployment or connector-specific tokens through the platform secret path. When S3 fetches are enabled, keep `S3_ENDPOINT` internal and scope deployment S3 credentials to reviewed buckets/prefixes. For connector-level S3 credentials, use a value-capable `SECRET_RESOLVER_DRIVER` with an `env://`, `vault://`, `aws-sm://`, `gcp-sm://`, or `azure-kv://` JSON secret containing `accessKeyId` and `secretAccessKey`, or provide a custom reader for a site-specific secret backend. For Confluence/Jira, prefer internally mirrored Atlassian endpoints in air-gapped deployments and store each connector secret as a managed JSON value containing either `email` plus `apiToken` or `bearerToken`/`token`. For Notion, Linear, and Slack, prefer internally mirrored API gateways or explicitly approved egress brokers; Notion connector secrets can be raw tokens or JSON `token`/`bearerToken`/`accessToken`, Linear connector secrets can be raw API keys, JSON `apiKey`, or JSON bearer tokens, and Slack connector secrets can be raw tokens or JSON `token`/`botToken`/`bearerToken`/`accessToken`.

## Secrets and Auth

Set `DEV_SEEDED_LOGIN=false` outside local development. Configure `SESSION_SECRET`, `WEBHOOK_SIGNING_KEY`, object storage credentials, database credentials, and provider credentials through the private secret system.

OIDC should point at an internal identity provider. Browser PKCE login uses the configured `APP_ORIGIN` callback at `/api/v1/auth/oidc/callback`, so register that private URL with the IdP and keep issuer, authorization, token, and JWKS endpoints internal or explicitly approved. For enterprise SAML, either configure Romeo's direct SAML provider against an approved internal IdP entry point and managed IdP certificate ref, or use Keycloak as a broker and expose Romeo only to Keycloak's OIDC endpoint. For LDAP/Active Directory, either use Keycloak as the bridge or configure Romeo's direct LDAP/AD provider against an approved internal LDAPS or StartTLS endpoint with managed bind-secret refs. Internal deprovisioning jobs can call `/api/v1/admin/sso/oidc/deprovision` with an admin-scoped service-account key and confirmed OIDC subject; the endpoint does not contact the IdP and audits only derived IDs plus subject hashes.

## Operations

Run readiness before traffic cutover:

```sh
romeo readiness --base-url https://romeo.internal --api-key "$ROMEO_ADMIN_API_KEY"
```

Schedule Postgres backups inside the private environment:

```sh
DATABASE_URL="$DATABASE_URL" pnpm backup:postgres -- --output backups/romeo-postgres.dump --retention-days 30
```

Use `POSTGRES_BACKUP_UPLOAD_URL` and `POSTGRES_BACKUP_MANIFEST_UPLOAD_URL` with internal object-storage presigned PUT URLs when backups must leave the job filesystem. Set `POSTGRES_BACKUP_UPLOAD_TIMEOUT_MS` to match private object-store latency; the default is `30000` and bounds each upload PUT. Archive both the dump and the generated `*.manifest.json`; the manifest records bytes, SHA-256, retention metadata, and a redacted database identifier.

Backups and evidence stores must use encrypted media or server-side encrypted object storage controlled inside the private environment. Treat presigned URLs as short-lived secrets, keep KMS/HSM key identifiers out of general support bundles unless policy allows them, and record only encryption posture such as `encrypted_target=true`, retention days, checksum, byte count, and restore target class. Do not export raw database URLs, object-store credentials, bucket names that encode tenant names, backup object keys, or key material in evidence.

Test restore into an isolated target database before every major upgrade:

```sh
DATABASE_URL="$RESTORE_DATABASE_URL" POSTGRES_RESTORE_DOWNLOAD_URL="$PRESIGNED_BACKUP_GET_URL" pnpm restore:postgres -- --input backups/romeo-postgres.dump --expected-sha256 "$BACKUP_SHA256" --confirm
```

Write DR drill evidence from the same isolated target:

```sh
DRILL_DATABASE_URL="$ISOLATED_RESTORE_DATABASE_URL" POSTGRES_RESTORE_DOWNLOAD_URL="$PRESIGNED_BACKUP_GET_URL" pnpm drill:postgres-restore -- --input backups/romeo-postgres.dump --expected-sha256 "$BACKUP_SHA256" --confirm-isolated-target
```

Keep audit, usage, access review, SBOM, security evidence, release-channel metadata, upgrade validation, and backup artifacts in the internal evidence store for compliance review.
