# scripts

Repository tooling invoked through `pnpm <name>` (see the root `package.json`).

| Area          | Scripts                                                                                                                                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static checks | `check:architecture` (500-line file ratchet), `check:source-suppressions`, `check:dns-pinning-parity`, `check:version-consistency`, `check:public-api-errors`, `check:database-evolution-policy` (migration ledger)                                              |
| API contract  | `openapi:export`, `contract:lint`, `contract:breaking`, `check:openapi-route-coverage`, `sdk:typescript`, `sdk:python`, `check:sdk-typescript-drift`, `check:sdk-drift`                                                                                          |
| Tests         | `test:coverage`, `test:postgres-conformance`, `quality:browser`, `test:browser:*`                                                                                                                                                                                |
| Deploy checks | `smoke:compose*`, `smoke:kubernetes:render`, `check:helm-production-policy`, `check:container-image-policy`, `smoke:ssr-render`                                                                                                                                  |
| Operations    | `migrate:postgres`, `seed:postgres`, `validate:postgres`, `backup:postgres`, `restore:postgres`, `backup:object-store`, `restore:object-store`, `restore:coordinated`, `monitoring:export`, `validate:operational-monitoring`, `support:bundle`, `sbom:generate` |

Operational scripts run inside the `ops-runtime` image (see `deploy/compose/Dockerfile`).
