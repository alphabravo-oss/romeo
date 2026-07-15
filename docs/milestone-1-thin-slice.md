# Milestone 1 Thin Slice

Milestone 1 is the first executable proof of Romeo.

Required flow:

1. User enters the app with seeded local development identity.
2. Default organization and workspace are available.
3. Admin/provider page can show OpenAI-compatible and Ollama provider records.
4. A default assistant can be selected.
5. User creates or opens a chat.
6. User starts a run.
7. Assistant output streams over SSE.
8. Run can be cancelled.
9. Final messages and run events are replayable.
10. Service-layer authorization protects every run.
11. `/api/v1/health` returns a readiness signal.
12. `/api/v1/openapi.json` exposes the Milestone 1 public API contract.

Completion requires tests, type checks, production build verification, HTTP API smoke tests, and desktop/mobile shell checks.
