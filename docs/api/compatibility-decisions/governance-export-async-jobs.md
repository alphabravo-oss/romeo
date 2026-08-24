# Governed exports use durable asynchronous jobs

`POST /governance/data-exports/packages` now returns `202` with a
`DataExportPackageJob` instead of synchronously returning a completed package
with `200`. The synchronous contract required request handlers to collect and
serialize potentially large tenant exports before responding, which could not
provide durable progress, restart recovery, bounded memory use, or safe retry
semantics.

Clients must retain the returned `packageId`, poll
`GET /governance/data-exports/packages/{packageId}`, and handle the
`queued`, `running`, `artifact_ready`, `failed`, and `expired` states. When the
job reaches `artifact_ready`, clients download the artifact through its
authorized `downloadUrl`. The download response is a streamed binary body; the
artifact metadata supplies its authoritative media type.

This breaking pre-2.0 correction is intentionally not emulated with a legacy
`200` path because doing so would reintroduce synchronous, unbounded export
execution. The old response is retired at the 2.0 contract boundary.
