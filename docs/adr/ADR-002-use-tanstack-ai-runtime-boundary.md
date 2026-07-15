# ADR-002 Use TanStack AI Runtime Boundary

Status: Accepted

Romeo will keep AI runtime orchestration behind `packages/ai-runtime`. TanStack AI can be used inside that boundary, but app, API, and provider code must depend on Romeo product events instead of raw third-party stream shapes.
