# Provider kind catalog

Romeo exposes the provider protocols compiled into the running server through
`GET /api/v1/provider-kinds`. The catalog is static product metadata, not a list
of configured tenant providers.

## Source of truth

Each entry is derived from the provider dialect registry and the default model
capability descriptor for that kind. The response contains:

- the stable provider kind and reviewed display name;
- default and supported local/external deployment classifications;
- dialect contract and implementation versions;
- a complete operation support map derived from registered adapters;
- default model capabilities, explicitly labeled as defaults rather than
  probed per-model truth; and
- a strict versioned list of supported configuration fields.

The configuration field list uses a finite identifier and input-type union. It
does not contain HTML, arbitrary component names, executable validation, a
configured endpoint, a credential reference, or any field value. Clients own
localized labels and reviewed controls for each field identifier.

Generic OpenAI-compatible protocols support both external and local endpoint
classifications. Their default classification is external, but the effective
network boundary must be determined from the configured endpoint and policy;
the catalog classification never authorizes egress. Anthropic is external-only
and Ollama is local by default.

## Authorization and security

The endpoint requires an authenticated principal with `providers:read` (or the
existing administrator equivalent). It returns the same installed product
metadata to authorized organizations and never reads provider rows or secret
storage. Provider creation, verification, model discovery, grants, capability
policy, DNS-pinned egress, and managed-secret resolution remain separate
action-time controls.

`credentialRef` is described only as a sensitive, write-only
`secret_reference` field. The server never returns configured references or raw
credentials through this catalog. The response schema is strict and bounded to
32 provider kinds and eight fields per kind.

## Compatibility

The catalog and dialect contracts are additive generated-API surfaces.
Configuration metadata has its own `schemaVersion`; clients must ignore a new
provider kind they do not recognize and use reviewed controls for known field
IDs. Provider connection APIs remain authoritative if a stale client submits a
request directly.

## Validation

- Contract tests reject arbitrary field IDs, server-supplied values, and extra
  tenant configuration.
- Core tests validate all catalog entries against the public schema, verify
  local/external and operation truth, require `providers:read`, prove defensive
  copies, and run the HTTP route with privacy sentinels.
- OpenAPI route coverage, TypeScript/Python SDK drift, provider registry truth
  tests, and architecture gates protect the generated surface.

The catalog is the prerequisite for schema-driven provider setup. It does not
yet provide provider/model probes, regional/workload-identity configuration, or
per-model effective capability reports; those remain later EP-05 slices.
