# Runtime dependency ownership

Romeo creates outbound clients and readiness caches once per API process. Request scopes create services over a short-lived repository proxy, authenticated subject, or tenant-managed secret resolver; the HTTP request itself is never a database transaction.

| Lifetime                  | Owned dependencies                                                                                                                                                                                                                                                                                                                                 | Isolation rule                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Process                   | object-store client and telemetry wrapper, Valkey quota coordinator, chat/run event transports, notification delivery clients, cloud-secret SDK clients, bounded Qdrant client pool, provider circuit breaker, shared OIDC discovery/JWKS cache, OCR/extraction/scanning providers, voice provider, readiness state and single-flight probe caches | Must not capture a repository, transaction, subject, organization ID, or tenant-managed secret router         |
| Request/system scope      | API-key, session, and OIDC authentication services over a system-scoped short-lived repository proxy                                                                                                                                                                                                                                               | Each repository method opens a fresh coordinator-role transaction; explicit `repository.transaction` pins one |
| Request/tenant scope      | repository-backed domain services and the `romeo-secret://` routing resolver over a tenant-scoped short-lived repository proxy                                                                                                                                                                                                                     | Each repository method opens a fresh tenant-role transaction; streams and callbacks may retain only the proxy |
| Worker claim/tenant lease | repository-backed worker services                                                                                                                                                                                                                                                                                                                  | Must use the exact fenced tenant scope supplied by the coordinator or broker                                  |

Notification transports are process-owned. PagerDuty and FCM receive the request-scoped managed-secret resolver as an operation argument, so sharing the transport does not retain a tenant repository or secret router.

The Qdrant pool uses a random process-keyed credential fingerprint and a bounded LRU. It can reuse a connection for the same resolved deployment credential without storing a plaintext credential as a cache key or allowing tenant/rotation cardinality to grow without bound. OIDC clients remain repository-scoped for provisioning, but share bounded discovery, JWKS, and refresh-cooldown state whose cache keys contain only issuer, endpoint, and client-ID metadata.

The provider circuit breaker is also process-owned and is shared by native runs and OpenAI-compatible chat/embedding requests. A failing provider therefore opens one authoritative circuit across short request scopes; creating a new tenant repository scope cannot reset operational health state or bypass the configured cooldown.

The PostgreSQL request-scope proxy activates the exact RLS role and tenant setting for one repository operation at a time. `repository.transaction(callback)` is the sole API that pins that scoped repository for a multi-operation atomic unit, including nested savepoints. Provider streams, SSE replay, lease heartbeats, support-session audit, and supervised callbacks can safely retain the proxy because using it later acquires a new bounded database unit; they cannot retain the transaction that authorized the original HTTP response.

`/api/v1/health` and the internal `/readyz` route use the root process registry. A burst of readiness requests therefore shares one bounded single-flight cache instead of recreating clients or issuing one destructive object-store probe per request.

Shutdown order is fail-closed:

1. Mark readiness as draining and stop accepting work.
2. Stop and drain internal schedulers and repository-backed workers.
3. Close process-owned run/chat transports and the quota coordinator exactly once.

Library callers that construct a full runtime own `runtime.close()`. The close operation is idempotent; a second call does not close clients again.
