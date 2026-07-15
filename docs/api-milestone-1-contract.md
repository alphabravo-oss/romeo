# Milestone 1 API Contract

Milestone 1 endpoints:

- `GET /api/v1/health`
- `GET /api/v1/openapi.json`
- `GET /api/v1/me`
- `GET /api/v1/organizations`
- `GET /api/v1/workspaces`
- `GET /api/v1/providers`
- `POST /api/v1/providers`
- `POST /api/v1/providers/{providerId}/sync`
- `GET /api/v1/models`
- `GET /api/v1/agents`
- `POST /api/v1/agents`
- `POST /api/v1/agents/{agentId}/clone`
- `GET /api/v1/chats`
- `POST /api/v1/chats`
- `GET /api/v1/chats/{chatId}`
- `GET /api/v1/chats/{chatId}/messages`
- `GET /api/v1/chats/{chatId}/comments`
- `POST /api/v1/chats/{chatId}/comments`
- `GET /api/v1/chats/{chatId}/shares`
- `POST /api/v1/chats/{chatId}/shares`
- `GET /api/v1/notifications`
- `POST /api/v1/notifications/{notificationId}/read`
- `POST /api/v1/runs`
- `GET /api/v1/runs/{runId}`
- `GET /api/v1/runs/{runId}/events`
- `POST /api/v1/runs/{runId}/cancel`
- `GET /api/v1/tools`
- `POST /api/v1/tools/{toolId}/execute`

Run events:

- `run.started`
- `message.started`
- `message.delta`
- `message.completed`
- `run.cancelled`
- `run.completed`
- `run.failed`

The SSE endpoint must replay persisted events before streaming active events.
