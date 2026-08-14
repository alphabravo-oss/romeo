# Realtime voice threat model

Status: approved design boundary for EP-08-01. This document does not claim that
the EP-08 gateway or realtime provider adapters exist.

Owner: Romeo security and realtime platform maintainers  
Review trigger: before the first realtime endpoint is enabled, after a media or
identity protocol change, and at least annually  
Last reviewed: 2026-08-14

## Security objective

Realtime voice must not weaken the controls that apply to text chat. A live
audio session is an expiring, explicitly consented transport into one authorized
chat. It cannot grant broader model, tool, knowledge, provider, file, retention,
or egress access; expose a long-lived provider credential; or turn uncommitted
audio and partial transcripts into durable records by accident.

The safe default is no realtime session, no microphone access, no raw-audio
retention, no TURN relay, no public-network provider, and no tool execution. An
administrator must enable the capability and its deployment/network/provider
dependencies. The user must still make an explicit per-session microphone
choice.

## Assets and data classes

| Asset                                 | Sensitivity                 | Durable by default                   | Required protection                                                                |
| ------------------------------------- | --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| Microphone frames and VAD buffers     | Restricted content          | No                                   | Memory-only bounded ring buffer, zero on end/failure, never log                    |
| Partial STT hypotheses                | Restricted content          | No                                   | Memory-only, bounded, DLP window, not audit/event payloads                         |
| Committed transcript                  | Governed message content    | Policy-dependent                     | DLP before provider dispatch and persistence, retention/legal hold/export controls |
| Assistant response text/audio         | Governed model output       | Text by policy; audio off by default | Output DLP/firewall, authorized file/part storage, short-lived access              |
| Session capability/ICE credential     | Secret                      | Only a hash/status record            | Session/chat/subject-bound, single purpose, short expiry, replay protection        |
| Provider/STT/TTS credential           | Secret                      | Encrypted reference only             | Server-side resolution, never sent to browser/TURN/logs                            |
| Tool approval and result              | High-impact control/content | Existing governed records only       | Ordinary tool authorization and approval; voice is not approval evidence           |
| Usage, quality, and security evidence | Metadata-only               | Yes                                  | Bounded identifiers/counts/codes; no audio/transcript/provider bodies              |

## Trust boundaries

1. The browser and operating-system media stack are untrusted input producers.
   Device labels, SDP, ICE candidates, codecs, timing, and audio can be malformed
   or attacker-controlled.
2. The realtime gateway is the only public media/control termination point. It
   authenticates the ordinary Romeo credential, resolves current authorization,
   mints ephemeral session material, and owns lifecycle/limits.
3. TURN is an optional untrusted relay. It receives only short-lived,
   session-scoped credentials and encrypted WebRTC traffic; it is never an
   unrestricted general relay.
4. Native realtime providers and STT/TTS providers are external egress
   destinations. The canonical DNS-pinned egress and organization destination
   policy apply before a connection is opened.
5. The core API, repositories, object store, run event transport, and policy
   services remain authoritative for durable state. A gateway cannot write
   messages, files, audit events, or usage directly around those services.
6. Local adapters are still separate workers. Air-gapped mode must not load
   external ICE, TURN, telemetry, models, voices, or package resources.

## Required session protocol

- Session creation reauthorizes the subject, chat/workspace/agent/model/provider,
  capability hierarchy, current grants, quota, data destination, and effective
  retention/DLP policy before minting any connection material.
- The request uses a durable idempotency receipt. Reuse with different chat,
  model, voice, language, retention, or policy input is a conflict.
- The returned credential is random, at least 128 bits, stored only as a keyed
  digest, bound to session, subject credential generation, organization,
  workspace, chat, negotiated origin, protocol version, and expiry. It permits
  one active connection unless an explicit bounded reconnect window is used.
- Connection establishment consumes a nonce. Reconnect rotates connection
  material; it does not replay the creation credential. Expired, revoked,
  previously consumed, cross-origin, cross-session, or wrong-protocol material
  fails with one privacy-safe error.
- A bounded authorization heartbeat rechecks session/API-key revocation, user
  disablement, chat grant, capability, and provider policy. Revocation drains
  output, stops media, clears volatile buffers, and prevents further durable
  writes.
- Session duration, idle time, setup time, reconnect count/window, bitrate,
  packet rate, decoded sample rate/channels, audio buffer bytes, transcript
  characters, output queue bytes, and concurrent sessions are hard bounded.
- End is idempotent. Disconnect, process crash, deployment drain, policy loss,
  quota exhaustion, and provider failure all reach a terminal state through a
  lease/CAS or equivalent single-owner protocol.

## Threats and mandatory controls

### Microphone consent and covert capture

- Romeo never requests microphone permission on page load, hover, route
  preload, or session restore. A labeled user action starts the browser prompt.
- The UI presents listening, muted, reconnecting, and stopped states in visual
  and accessible text. The operating-system indicator is not treated as the
  only notice.
- Mute stops track transmission at the source and the gateway discards late
  frames. Ending removes tracks, closes peer/data channels, releases audio
  elements/contexts, clears buffers, and cannot auto-restart after navigation,
  reconnect, or refresh.
- Device identifiers stay browser-local unless a finite non-identifying
  preference is necessary. Raw device labels never enter audit or telemetry.

### Session hijack, CSRF, and replay

- Session creation/end use the normal authenticated API, CSRF/origin policy,
  request-ID bounds, and authorization scopes. WebSocket/WebRTC control upgrade
  also validates Origin and the ephemeral session credential.
- URLs, fragments, logs, referrers, analytics, support bundles, and SDP never
  contain the ordinary session cookie/API key or provider credential.
- A stolen ephemeral credential has a short lifetime, narrow session audience,
  connection-use nonce, and no REST/tool/file authority. Credential rotation and
  subject revocation invalidate it promptly.
- Control events carry monotonic session sequence numbers. Duplicate, stale,
  skipped-outside-window, or cross-session events cannot commit transcript,
  interruption, tool, or terminal state twice.

### TURN and network abuse

- TURN is disabled unless an administrator supplies an allowlisted deployment.
  Credentials are REST-minted per session with the shortest operational TTL.
- Relay allocation is bound to Romeo clients, allowed transports/ports, maximum
  allocations, peers, bytes, bitrate, and lifetime. Private/control/metadata
  destinations and arbitrary peer relay are denied.
- The gateway and TURN run in separate identities/network policies. TURN has no
  database, object-store, provider, Kubernetes, cloud-metadata, or internal API
  access. Abuse counters can disable TURN without disabling record/transcribe.
- Candidate and SDP parsing is bounded. Host candidates and local IP addresses
  are not persisted or included in customer-visible audit/support artifacts.

### Provider credential and destination isolation

- The browser receives only Romeo session/ICE material. Provider, STT, TTS,
  model-host, and TURN root secrets remain write-only encrypted server
  references resolved immediately before use.
- Every native or pipeline leg uses the selected provider adapter plus canonical
  destination/region/egress policy. No silent cross-provider or external
  fallback is permitted.
- Retry/fallback reauthorizes capability, data destination, residency, quota,
  and current grants before side effects. Safe errors expose stable categories,
  never provider bodies, hosts, credentials, stack traces, or raw messages.

### Injected, adversarial, and replayed audio

- Audio is untrusted user content even when a local microphone is selected.
  Codec headers and decoded media are validated with CPU/memory/time ceilings.
- Client timestamps, speaker identity, language, VAD events, and transcript are
  advisory; the gateway assigns authoritative sequence/time and validates state
  transitions.
- The product does not claim speaker authentication. Voice resemblance,
  playback, ultrasound, synthetic speech, and a transcript saying “approved”
  cannot satisfy password, MFA, consent, legal acknowledgement, or tool approval.
- Duplicate/replayed frames are bounded and ignored by sequence window. Optional
  abuse classifiers produce codes/counts only and cannot be represented as
  proof of human identity.

### Transcript and response DLP/firewall

- Partial hypotheses may be shown ephemerally but are not provider input or
  durable content. A committed transcript window is normalized and governed
  before provider dispatch and message persistence.
- Detectors define enough lookbehind to catch a match split across audio/STT
  chunks. Mandatory/block policy failure is fail-closed. Strict mode buffers a
  complete committed turn before provider dispatch.
- Assistant text is governed before TTS. High-security mode buffers the complete
  answer or approved segment before either text or audio is released. Tool
  arguments/results and retrieved content retain their ordinary policy boundary.
- Audits contain policy version, surface, detector/rule codes, counts, action,
  destination class, and outcome only—not transcript, matched text, audio, or
  custom pattern.

### Eavesdropping and media confidentiality

- WebRTC requires DTLS-SRTP; plaintext RTP and downgrade are rejected. REST and
  control transports require TLS in production. Internal hops use authenticated
  workload identity where supported.
- The gateway terminates media by design and is therefore inside the content
  trust boundary; the UI and documentation must not claim end-to-end encryption
  against Romeo or the selected provider.
- Raw audio is not copied into traces, crash reports, packet captures, metrics,
  debug logs, support bundles, or normal backups. Production diagnostics use
  synthetic media and metadata-only counters.

### Retention, deletion, and legal hold

- Effective mode is shown before connection: `no_audio` (default),
  `transcript_only`, or `governed_audio`. A lower layer cannot weaken an
  administrator/platform maximum; a user may request a more restrictive mode.
- Uncommitted frames/partials are always volatile. Governed audio is stored only
  as an access-controlled typed file/message part after scan/normalization and
  policy clearance; provider recordings are prohibited unless explicitly
  contracted and governed.
- Transcript/audio participate in retention, legal hold, export, deletion,
  tenant purge, backup/restore, key rotation/revocation, and orphan cleanup.
  Ending a session is not represented as deletion.
- Legal hold prevents destructive cleanup but does not make held audio available
  to an otherwise unauthorized subject. Download/render reauthorizes every time.

## Abuse and failure matrix

| Failure                                  | Required behavior                                                                   | Observable evidence                        |
| ---------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ |
| Gateway or policy dependency unavailable | No session credential; fail closed                                                  | reason code/count, dependency readiness    |
| Provider/STT/TTS unavailable             | Stop or bounded retry only if same policy destination; no hidden fallback           | leg category, retry count, terminal reason |
| Browser disconnect                       | Short bounded reconnect; volatile buffers expire; no duplicate commit               | reconnect/expiry counters                  |
| Authorization/capability revoked         | Stop input/output, clear buffers, terminal access-ended state                       | metadata-only revocation reason            |
| TURN unavailable                         | Direct path or explicit unavailable state; never public relay fallback              | relay attempt/outcome                      |
| DLP block or timeout                     | Do not dispatch/persist/release governed segment                                    | policy code/count/action                   |
| Slow consumer/provider                   | Bounded queues, backpressure/drop terminal behavior                                 | occupancy/high-water/drop counters         |
| Process deployment/crash                 | Stop claims, drain bounded sessions, expire/reclaim leases without duplicate commit | drain/lease lag/terminal counters          |

## Release-blocking validation

The following evidence is required before EP-08-02 or EP-08-03 can be called GA:

1. Unit/property tests for finite session state, invalid transitions, expiry,
   nonce replay, sequence replay, bounds, idempotent end, and privacy-safe errors.
2. Repository/live-PostgreSQL two-worker tests for claim/takeover/CAS terminal
   state, revocation races, duplicate transcript commit, retention, hold,
   deletion, tenant purge, and restore.
3. Browser matrix for explicit consent, denied permission, mute/end cleanup,
   device removal, route/logout/revocation, reconnect, Back/Forward, accessibility,
   and no microphone request during SSR/preload.
4. WebRTC fuzz/interoperability tests for SDP/ICE/codec/data-channel bounds,
   malformed packets, bitrate/buffer limits, DTLS-SRTP requirement, and drain.
5. TURN abuse tests for credential replay, allocation/peer/byte/time limits,
   private/metadata/control-plane denial, network-policy isolation, and kill switch.
6. DLP red-team tests with secrets/PII split across partial transcripts and answer
   chunks, Unicode/encoding variants, injected retrieved/tool content, policy
   outage, and strict buffered release. Sentinels must be absent from durable
   events, messages, files, logs, audits, SSE/control frames, and browser state.
7. Provider credential sentinels proving absence from browser material, SDP/ICE,
   TURN, errors, logs, traces, metrics, audit, support bundles, and stored media.
8. Load/chaos evidence at target concurrency and media rate: bounded memory/CPU,
   queue and notifier latency, interruption time, no duplicate/lost committed
   transcript, provider/TURN outage, gateway restart, and rolling deployment.
9. Air-gap acceptance with external DNS/egress disabled and only local
   STT/model/TTS adapters visible. Online acceptance records exact gateway/relay
   image digests and provider sandbox metadata, never customer audio.

## Explicit non-claims and open decisions

- This threat model does not implement the gateway, WebRTC transport, realtime
  adapters, VAD, streaming DLP, or governed audio storage.
- Romeo does not authenticate a person by voice and does not treat spoken words
  as tool approval, MFA, or a legal signature.
- Exact gateway isolation technology, supported TURN topology, transcript commit
  window, strict-output buffering window, maximum session/bitrate/concurrency,
  and supported local/native adapters remain release decisions for EP-08-02
  through EP-08-08.
- Manual mobile/enterprise-network testing and external penetration review remain
  required even when automated browser/WebRTC suites pass.
