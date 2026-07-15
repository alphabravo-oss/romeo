# ADR-007 Use Valkey for Cache and Queue Coordination

Status: Accepted

Romeo uses Valkey for cache, ephemeral state, rate limiting, and queue coordination. Valkey must not become the source of truth.
