# Romeo

Romeo is a greenfield AI workspace platform guided by `../romeo-full-product-prd.md`.

Open WebUI is a product and UX reference only. Romeo is not a fork, rebrand, or code reuse project.

The repository package scope, CLI command, SDK names, API metadata, and deployment examples now use Romeo naming.

## Milestone 1

The first executable slice proves:

- seeded local login or local auth path
- default organization and workspace
- OpenAI-compatible and Ollama provider records
- default model-backed assistant
- chat creation
- `POST /api/v1/runs`
- `GET /api/v1/runs/{runId}/events`
- `POST /api/v1/runs/{runId}/cancel`
- `GET /api/v1/health`
- `GET /api/v1/openapi.json`
- persisted messages and replayable run events
- object-level authorization on the run path

## Stack

- pnpm workspaces
- TanStack Start, Router, Query, Form, Table, Virtual, Store
- Hono and `@hono/zod-openapi` for `/api/v1`
- Drizzle schema for Postgres and pgvector-ready persistence
- Valkey, RustFS/S3, Docker Compose, and Helm deployment structure

## Local Development

```bash
pnpm install
pnpm dev
```

### If `pnpm` fails with "Failed to switch pnpm to v11.7.0 ... ENOENT"

This repository pins `pnpm@11.7.0` via the `packageManager` field. The
standalone pnpm installer (`~/Library/pnpm/pnpm` on macOS) manages its own
versions and **cannot install pnpm 11.x** — it fetches the platform package but
never creates the `bin/` directory the shim then looks for, so it fails with
`ENOENT` on every invocation.

Corepack handles the pinned version correctly. Activate it once:

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
```

Then make sure your Node `bin` directory precedes the standalone pnpm on
`PATH`, so corepack's shim wins:

```bash
# check which one is first — it should be the Node/corepack one
which -a pnpm
```

If `~/Library/pnpm/pnpm` still comes first, either remove the standalone
install or move your Node bin ahead of it in your shell profile.

Without that, every command in this README still works when prefixed with
`npx --yes pnpm@11.7.0` — for example `npx --yes pnpm@11.7.0 verify`.

The dev server prints its local URL when it starts. The Milestone 1 API uses an in-memory repository by default so the app can run before external services are configured.

## Verification

```bash
pnpm verify
```

`pnpm verify` runs tests, TypeScript checks, and the production build across the workspace.

Generate a CycloneDX SBOM for release artifacts with:

```bash
pnpm run sbom:generate -- --output release/sbom.cdx.json
```

Generate package tarballs and release-channel metadata with:

```bash
pnpm release:pack
pnpm release:channel -- --manifest dist/release/release-manifest.json --output dist/release/release-channel.json
```

Generate release security evidence and validate an upgrade candidate with:

```bash
pnpm release:security -- --manifest dist/release/release-manifest.json --sbom dist/release/sbom.cdx.json
pnpm release:upgrade-check -- --channel-file dist/release/release-channel.json
```

Inspect Postgres backup/restore command plans with:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/romeo pnpm backup:postgres -- --dry-run --retention-days 30
DATABASE_URL=postgres://user:password@localhost:5432/romeo pnpm restore:postgres -- --input backups/romeo-postgres.dump --expected-sha256 "$BACKUP_SHA256" --dry-run
DRILL_DATABASE_URL=postgres://user:password@localhost:5432/romeo_drill pnpm drill:postgres-restore -- --input backups/romeo-postgres.dump --expected-sha256 "$BACKUP_SHA256" --dry-run
```

Private-network deployment notes live in [docs/air-gapped-deployment.md](./docs/air-gapped-deployment.md).

## Migration Discipline

The greenfield baseline is locked at `packages/db/migrations/0000_greenfield_baseline.sql`. Keep Drizzle schema changes split by domain under `packages/db/src/schema`; future schema changes require forward-only migrations with upgrade tests and rollback or mitigation notes. Do not add corrective migration chains that undo earlier greenfield mistakes.
