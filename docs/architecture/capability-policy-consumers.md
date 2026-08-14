# Capability policy consumers

The generic capability plane currently governs three real server operations. The
registry is additive and versioned (`cap-registry-v2`); it is not a catalog of
aspirational flags.

| Capability         | Assignment layers       | Configuration                                       | Enforcement boundary                                                                         |
| ------------------ | ----------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `image_generation` | organization, workspace | maximum image count and intersected sizes           | Before quota reservation, provider, object storage, or message writes                        |
| `web_retrieval`    | organization            | maximum search results (10) and URLs per ingest (5) | Before quota, credentials, DNS/egress checks, or provider/network fetch                      |
| `voice_processing` | organization            | none                                                | Before voice catalog, transcription, or synthesis provider calls and before artifact storage |

Organization-only capabilities reject workspace assignments. Their effective
API may still receive a workspace context so normal tenant and workspace access
checks run, but that context cannot create a workspace override. Disabled policy
uses deny precedence. Enabling a capability does not bypass scopes, ACLs, abuse
controls, quotas, content policy, provider configuration, or network policy.

Generic provider readiness is intentionally reported as `unknown`; individual
services remain authoritative for configured/healthy provider state. Batch voice
processing is not realtime voice, so the `realtime_voice` deployment switch does
not govern it. Web retrieval has no separate deployment flag: its mandatory
configuration, credential, SSRF, DNS, and egress policies remain security floors.

The existing capability-assignment table already stores bounded JSON
configuration against a string capability ID, so this registry expansion needs
no schema migration. In-memory and PostgreSQL repositories use the same immutable
version/CAS/history contract and tenant purge behavior.

The program remains incomplete: most roadmap capabilities are not registered;
agent/group/user assignment layers, preview/publication workflow, invalidation,
and complete admin controls for capability-specific configuration remain future
work. New registry entries must not ship until every side-effecting consumer is
identified and protected by the shared resolver.
