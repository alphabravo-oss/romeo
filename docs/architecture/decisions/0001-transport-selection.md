# ADR-0001: Transport selection and durable event delivery

**Status:** Accepted  
**Date:** 2026-08-14  
**Roadmap:** EP-01, EP-08, EP-11

## Context

Romeo needs resumable text generation, tool/approval state, media progress, comparison
fan-out, and low-latency voice. One transport cannot optimize every interaction.
Polling the full run history is expensive, while treating a socket or pub/sub channel
as the system of record loses events during reconnects and deploys.

## Decision

1. REST is the command and bounded-query transport.
2. SSE is the canonical server-to-client transport for durable ordered run events,
   tool/approval progress, image jobs, exports, and similar one-way streams.
3. WebRTC is preferred for realtime bidirectional audio/media. A WebSocket gateway is
   allowed only where WebRTC is unavailable or for bounded control messages.
4. Every externally observable durable event is committed with a monotonic sequence
   before publication. Pub/sub is a wake-up accelerator, never the source of truth.
5. SSE resumes with a validated cursor/`Last-Event-ID`, reads strictly after the
   cursor, and emits idempotent typed events. Reconnect never restarts provider work.
6. Long-lived streams periodically revalidate the current credential, grants, and
   resource ACL. Revocation terminates with a stable content-free error.
7. Heartbeats, bounded buffers, slow-consumer handling, cancellation, terminal close,
   drain behavior, and proxy timeouts are explicit contracts.
8. Streaming content is never cached by a shared intermediary. Compression and proxy
   buffering must be proven against the deployed ingress.

## Consequences

- Clients need a reducer that tolerates replay and unknown additive event types.
- Provider callbacks, queues, and notifier outages cannot bypass durable persistence.
- Bidirectional voice is a separate governed capability and cannot reuse text SSE as
  an accidental audio tunnel.
- Compare/export/workflow streams reuse the same event envelope and authorization
  rules rather than creating feature-specific socket protocols.

## Validation

- Cursor, duplicate, gap, reconnect, cancel, terminal, revocation, and lease-loss tests.
- Browser/proxy matrix for split chunks, heartbeats, compression, idle close, and resume.
- Multi-node failure tests with notifier unavailable and database as the recovery path.
- Metrics for active streams, replay volume, lag, buffer pressure, slow consumers,
  terminal-close latency, authorization termination, and notifier fallback.

## Reconsider when

Browser support or deployment constraints make a different standard transport
materially safer, or measured SSE fan-out cannot meet the published SLO without
changing the durable-event guarantees.
