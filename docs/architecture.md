# Architecture

Romeo is a TypeScript monorepo with clear runtime boundaries:

- `apps/app`: TanStack Start web app and server route bridge.
- `packages/core`: public API contract, Hono app, domain services, and repository ports.
- `packages/db`: Drizzle schema and database client helpers.
- `packages/auth`: sessions, scopes, permissions, resource grants, and run-path authorization.
- `packages/providers`: model provider adapters and capability discovery.
- `packages/ai-runtime`: run orchestration, streaming event normalization, cancellation, and replay.
- `packages/tools`: built-in tool registry and safety metadata.
- `packages/rag`: retrieval interfaces and disabled default provider boundary.
- `packages/voices`: voice profile and speech provider interfaces.
- `packages/api-client`: typed client for the stable Milestone 1 API surface.
- `packages/config`: type-safe environment and feature flags.
- `packages/ui`: shared UI primitives.

Milestone 1 uses an in-memory repository behind the same service interfaces that later Postgres-backed repositories must implement. This keeps the first vertical slice runnable while preserving the Postgres source-of-truth design.

## Migration Policy

Romeo is greenfield, so schema work should converge before migration files are committed. Do not create chains of corrective migrations during initial construction. Use one reviewed baseline migration for the first stable schema, then create future migrations only for intentional product changes.

## Boundary Rules

- `/api/v1` is product-level and stable.
- TanStack server functions may exist for web-only flows, but cannot replace the public API contract.
- Provider-specific APIs stay behind provider adapters.
- Authorization is enforced in services, not only route handlers.
- Tool execution always goes through the tool safety registry.
- RAG and voice capabilities grow behind their own packages instead of being absorbed into `core`.
