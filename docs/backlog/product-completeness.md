# Backlog Track: Product Completeness

This track covers the remaining user-facing and integration features needed to move Romeo from a strong platform baseline to a full product. The detailed tasks are split so runtime integration work and client/channel work can evolve independently.

The phase order and evidence gates are summarized in [Phase Execution Matrix](./phase-execution-matrix.md). Each product capability phase must still meet the global backlog rules in the parent backlog: no broad catch-all modules, no in-process arbitrary user code, no secret-bearing audits/jobs/logs, and no Compose-only assumptions.

Concrete execution tickets for Phase 24 through Phase 31 live in [Product Capabilities](./execution/product-capabilities.md).

## Files

- [Integration Runtime](./product-integrations.md): delegated OAuth, out-of-process tool workers, live model-driven tool orchestration, and connector sync expansion.
- [Client Experience And Automation](./client-experience-and-automation.md): voice/media, notification and collaboration adapters, native clients, and advanced browser automation.

## Phase Map

- Phase 24: Delegated Connector OAuth.
- Phase 25: Out-of-Process Tool Execution Workers.
- Phase 26: Live Model-Driven Tool Orchestration.
- Phase 27: Connectors and Sync Expansion.
- Phase 28: Voice, Media, and Native Capture.
- Phase 29: Collaboration, Notifications, and Customer Adapters.
- Phase 30: Native Desktop and Mobile Clients.
- Phase 31: Advanced Browser Automation Worker.

## Sequencing

Delegated OAuth should precede customer connectors that need user consent. Out-of-process tool execution should precede live model-driven tool orchestration. Native clients and browser automation should remain optional until deployment requirements justify their operational and security cost.
