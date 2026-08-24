# Workflow reference inventory

The product workflow feature is retired. Remaining references belong to one of four reviewed categories and may not silently move between them.

1. **Compatibility API:** `packages/contracts/src/workflows.ts`, the nine tombstones in `packages/core/src/http/routes/retired-workflows.ts`, generated clients, the API baseline, and the deprecation ledger remain until the published sunset and zero-usage gates pass.
2. **Governed historical data:** `workflow_definitions` and `workflow_runs`, their repository methods, export/purge/legal-hold coverage, schema snapshots, and the metadata-only retirement migration remain while customer records exist. They are not an active execution surface.
3. **Persisted browser-automation lineage:** the historical `workflow.browser_task.*` job and audit discriminators plus `workflowId`/`workflowRunId` payload fields are wire/storage compatibility for already persisted tasks and audit history. Active modules use `browser-automation-*` names; changing persisted discriminators requires an additive reader, migration, and usage proof.
4. **Generic process language:** phrases such as approval workflow, CI workflow, deletion workflow, or extension workflow describe a process rather than the retired product domain and need no compatibility handling.

The live application has no `WorkflowsPanel`, workflow table inventory, mutation policy, scheduler, creator, approver, resumer, or executor. The database inventory deliberately retains the two historical tables while the UI inventory deliberately excludes them. `pnpm check:workflow-retirement-inventory` enforces the boundary, rejects destructive retirement SQL, verifies all tombstones and ledger entries, and prevents stale workflow-prefixed browser module names from returning.
