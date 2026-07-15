# API Design

Public API rules:

- all external routes live under `/api/v1`
- every response includes or propagates a request id
- errors use the stable error envelope
- mutations accept `Idempotency-Key` where replay would be harmful
- object-level authorization is enforced in service code
- streaming uses SSE for external clients

Error envelope:

```json
{
  "error": {
    "code": "forbidden",
    "message": "You do not have access to this resource.",
    "request_id": "req_...",
    "details": {}
  }
}
```
