# Workflow API retirement

The legacy workflow execution feature is retired as of 2026-08-23. Its nine
authenticated API operations remain available as compatibility tombstones
through the published deprecation period. They return the stable
`workflow_feature_retired` conflict response and do not create, schedule,
approve, resume, or execute workflows.

Existing workflow definition and run records are retained. They remain within
tenant purge, retention, legal-hold, and export governance rather than being
destructively removed with the feature surface.

## Client migration

1. Stop creating new workflow definitions or scheduling workflow runs.
2. Treat `workflow_feature_retired` as a terminal, non-retryable response.
3. Use the run, queued-chat-turn, browser-automation, notification, and managed
   model APIs directly for supported automation scenarios.
4. Preserve any identifiers needed to reconcile historical exports.

The compatibility endpoints are eligible for removal after 2027-02-23 and only
after the required zero-usage evidence window has been satisfied.
