# Admin Remediation Baseline

Captured **2026-07-29**, immediately after Phase 0 landed the four guardrail
assertions in `scripts/admin-console-audit.mjs` and before any UI work began.

Reproduce with:

```bash
pnpm quality:browser
```

Exit code is **1** at baseline. Every row below must reach ✅ before the
remediation plan
(`docs/superpowers/plans/2026-07-29-admin-console-remediation.md`) is complete.
The audit runs each section at both `desktop` (1440×1000) and `mobile`
(390×844); failures were identical across viewports, so rows are listed once.

## Assertion legend

| Key                      | Assertion                                                      | Added in |
| ------------------------ | -------------------------------------------------------------- | -------- |
| `primary-actions`        | A page renders more than one `.rm-ui-button--primary`          | Task 0.1 |
| `identifier-leak`        | An internal snake_case token or error code is visible          | Task 0.2 |
| `unguarded-destructive`  | A `.rm-ui-button--danger` outside a danger zone with no dialog | Task 0.3 |
| `incomplete-empty-state` | An `.rm-ui-empty` missing its icon or description              | Task 0.4 |

## Open findings

| Section               | Assertion                | Detail                                                                                    | Cleared by | Status |
| --------------------- | ------------------------ | ----------------------------------------------------------------------------------------- | ---------- | ------ |
| access                | `primary-actions`        | `+ Add API key` \| `+ Add service account`                                                | Task 4.2   | ☐      |
| access                | `incomplete-empty-state` | "No API keys yet." / "No service accounts yet."                                           | Task 1.4   | ☐      |
| connections           | `primary-actions`        | **10×** `Add connector` in the Catalog tab                                                | Task 4.2   | ☐      |
| connections           | `primary-actions`        | `+ Import tool` ×2 (Tool connectors tab)                                                  | Task 4.2   | ☐      |
| connections           | `identifier-leak`        | `local_import`                                                                            | Task 7.1   | ☐      |
| connections           | `incomplete-empty-state` | "No connectors yet." / "No connectors imported."                                          | Task 1.4   | ☐      |
| usage                 | `primary-actions`        | `+ Add quota` ×2 (Quotas tab)                                                             | Task 4.2   | ☐      |
| usage                 | `identifier-leak`        | `pipeline_duration`                                                                       | Task 7.1   | ☐      |
| usage                 | `incomplete-empty-state` | "No quotas yet."                                                                          | Task 1.4   | ☐      |
| webhooks              | `primary-actions`        | `+ Add webhook` ×2 (header + empty state)                                                 | Task 4.2   | ☐      |
| webhooks              | `incomplete-empty-state` | "No webhooks yet."                                                                        | Task 1.4   | ☐      |
| users                 | `unguarded-destructive`  | Red row-level `Disable`, no confirmation                                                  | Task 5.3   | ☐      |
| overview              | `identifier-leak`        | Raw job/run IDs: `terminal_webhook`, `job_run_terminal_run_*`, `run_*`, `run_execution_*` | Task 7.1   | ☐      |
| audit                 | `identifier-leak`        | `user_dev_admin`                                                                          | Task 7.1   | ☐      |
| rag                   | `identifier-leak`        | `user_private` (Policy tab)                                                               | Task 7.1   | ☐      |
| rag                   | `incomplete-empty-state` | "No change request on record."                                                            | Task 1.4   | ☐      |
| abuse                 | `identifier-leak`        | `past_due` (Controls tab)                                                                 | Task 7.1   | ☐      |
| connected-apps        | `incomplete-empty-state` | "No connections yet."                                                                     | Task 1.4   | ☐      |
| impersonation         | `incomplete-empty-state` | "No pending requests." / "No active sessions."                                            | Task 1.4   | ☐      |
| notification-channels | `incomplete-empty-state` | "No channels yet."                                                                        | Task 1.4   | ☐      |
| prompt-templates      | `incomplete-empty-state` | "No marketplace templates."                                                               | Task 1.4   | ☐      |
| workflows             | `incomplete-empty-state` | "No workflows yet."                                                                       | Task 1.4   | ☐      |

**22 open findings across 14 of the 24 sections.**

## Findings the assertions deliberately do NOT flag

These were identified in the design review but are out of the guardrails'
reach. They are still real work — they are covered by plan tasks and must be
verified by eye, not by the audit.

| Section         | Issue                                                                      | Why the audit stays silent                                                                                                                                                                                                 | Covered by                              |
| --------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| auth-providers  | 11-row catalog table where 10 rows are `Off · Not configured · Not tested` | Structural, not a rule violation                                                                                                                                                                                           | Phase 2                                 |
| connected-apps  | `delegated_oauth_provider_not_configured:github` rendered to the admin     | Wrapped in `<code>` **and** `translate="no"`, which the identifier check intentionally excludes. The exclusion is correct in general (technical tokens are sometimes deliberate) but this specific string should still go. | Task 3.1 Step 4                         |
| web-search      | 12 policy fields render live while `Enabled` is off                        | No rule expresses "gate on a toggle"                                                                                                                                                                                       | Task 6.1                                |
| chat-experience | 8 starter prompts all expanded, ~3000px scroll                             | No rule expresses page length                                                                                                                                                                                              | Task 6.2                                |
| governance      | `Save retention` and `Run retention now` at equal weight                   | Both are non-primary, non-danger today                                                                                                                                                                                     | Task 8.2                                |
| abuse           | `Organization suspended` is a plain checkbox                               | A checkbox is not a danger button, so `unguarded-destructive` cannot see it                                                                                                                                                | Task 5.1                                |
| usage, audit    | No date-range control                                                      | Absence of a control cannot be asserted generically                                                                                                                                                                        | Task 8.3                                |
| rag             | 6 stat tiles echo the form fields beneath them                             | Judgment call                                                                                                                                                                                                              | Out of scope — needs a product decision |
| posture         | `Ga checklist path not configured`                                         | Casing, not an identifier                                                                                                                                                                                                  | Task 7.2                                |

## How to update this file

When a task clears a row, flip `☐` to `✅` **and re-run `pnpm quality:browser`
to confirm** — do not mark a row from inspection alone. When every row is ✅
the command exits 0 and Task 9.1 can close the plan out.
