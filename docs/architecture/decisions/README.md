# Romeo architecture decisions

These records are normative for the enterprise AI roadmap. A feature may extend a
decision through a later ADR, but it must not silently implement a different
transport, content, provider, privacy, authorization, isolation, or encryption
model.

| ADR                                            | Decision                                       | Status   |
| ---------------------------------------------- | ---------------------------------------------- | -------- |
| [ADR-0001](./0001-transport-selection.md)      | Transport selection and durable event delivery | Accepted |
| [ADR-0002](./0002-typed-content-parts.md)      | Versioned typed content parts                  | Accepted |
| [ADR-0003](./0003-provider-dialect-plugins.md) | Provider dialect plugin boundary               | Accepted |
| [ADR-0004](./0004-reasoning-privacy.md)        | Reasoning privacy and retention                | Accepted |
| [ADR-0005](./0005-knowledge-acl-semantics.md)  | Knowledge ACL enforcement semantics            | Accepted |
| [ADR-0006](./0006-compute-isolation.md)        | Secure compute isolation                       | Accepted |
| [ADR-0007](./0007-tenant-encryption.md)        | Tenant encryption and customer-managed keys    | Accepted |

## Decision lifecycle

- **Proposed:** implementation must not depend on the decision yet.
- **Accepted:** new work must conform; existing exceptions need a tracked migration.
- **Superseded:** the replacing ADR is linked and compatibility/rollback are documented.
- **Retired:** the governed capability no longer exists and its data has been handled.

Changing an accepted security boundary requires an additive ADR, threat-model review,
migration and rollback plan, generated-contract impact review, and validation evidence.
Operational control never grants tenant plaintext access.
