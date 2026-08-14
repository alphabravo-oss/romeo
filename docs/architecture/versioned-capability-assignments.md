# Versioned capability assignments

Romeo's generic capability plane stores immutable assignment revisions for
organization, workspace, agent, group, and user scopes. A replacement revokes
the active row and appends a new version with its actor, bounded reason,
effective time, optional expiry, and predecessor. The active-row uniqueness and
optimistic version check are identical in memory and PostgreSQL.

## Resolution and precedence

The resolver evaluates all applicable scopes in this order for configuration:
organization, workspace, immutable published agent-version default, mutable
agent, sorted authenticated groups, and authenticated user. Numeric ceilings use
the minimum and allowlists intersect. A `disabled` assignment at any applicable
layer dominates every `enabled` or `required` assignment. A `required` state is
supported by the generic model, but a capability may omit it from its registered
`allowedStates`; the three current capabilities do so until their product
semantics define what mandatory selection means.

The complete sanitized decision evidence is emitted in deterministic control
order: deployment, platform, entitlement, organization, workspace, immutable
agent-version snapshot, mutable agent, all groups, user, action, resource,
provider/model, and quota. The assignment plane performs restrictive action
normalization before consumer-side quota and provider dispatch. Every stage is a
mandatory ceiling: a lower layer can narrow or deny, but can never enable through
an upper deny. Provider capability descriptors and quotas remain independent
runtime inputs rather than mutable assignments.

User and group identity is never accepted from the ordinary effective-policy
request. It is derived from the authenticated subject. Admin overview, history,
explain, and replacement may target an explicit identity only after an admin
check and same-tenant repository lookup. Missing and foreign IDs return the same
not-found boundary. Group/user overview and explain require an explicit,
authorized workspace whenever a workspace ceiling applies; the server never
chooses a workspace from administrator array order.

Agent context accepts an agent and optionally a version. Both are checked against
the caller's organization, workspace access, and each other. Run-scoped web
retrieval passes its actual workspace, agent, and version into the same resolver
before quota, credentials, DNS, egress, or network effects.

## Immutable agent-version defaults

Publishing an agent version transactionally copies the active mutable agent
assignments into a private `capability_defaults` snapshot. Each entry contains
only capability ID, state, strictly parsed bounded configuration, source
assignment version, and optional expiry. Later mutable agent changes can narrow
the snapshot but cannot weaken a deny or broaden its limits; publishing a new
agent version is required to change the immutable default.

Expiry is preserved. A default captured before expiry is ignored after expiry,
so a temporary enable or deny is never made permanent by publication. Effective
and admin explanation output may include the safe expiry and assignment/version
identifiers, but never snapshot configuration, user content, identity labels,
prompts, or secrets. Managed-model version APIs strip the private snapshot.

PostgreSQL limits the JSON snapshot to 16 KiB. The read/write mapper additionally
rejects unknown or duplicate capability IDs, more entries than the registry,
unknown fields, invalid states/versions/expiry, and configuration that does not
pass the capability's strict schema. Corruption fails closed rather than dropping
individual entries.

## Authorization, audit, and deletion

- Workspace and agent scopes require canonical workspace access in addition to
  same-tenant ownership.
- Group and user administration requires an administrator plus the existing
  `capabilities:read` or `capabilities:manage` scope.
- Mutation audit records include scope identifiers, state, assignment version,
  configuration field names, and whether an expiry exists. Reason text and
  configuration values are not copied into audit metadata.
- Tenant purge deletes every assignment scope in phase one and agent versions in
  phase two. In-memory purge follows the same inventory.
- UI controls are not an authorization boundary. Every API and runtime consumer
  recomputes policy server-side.

## Schema evolution and validation

Migration `0024_versioned_capability_assignment_scopes.sql` widens the existing
scope constraint and adds the private bounded agent-version snapshot. It is
restart-safe and previous-application compatible: old builds ignore the new
column and continue using organization/workspace rows. The strict migration
ledger records upgrade, restart, repair, backup/restore, tenant-purge, and schema
contract evidence paths.

Automated coverage includes strict contract parsing, caller-controlled identity
rejection, same-tenant negative authorization, exact two-workspace preview,
deny dominance, the full deterministic control-layer matrix, expiry at all five
persisted scopes, action-time agent enforcement, snapshot immutability and expiry,
sanitized explanation/audit output, corrupted/oversized JSON rejection,
in-memory/PostgreSQL scope parity, optimistic version conflicts, migration
inventory, and tenant purge.
