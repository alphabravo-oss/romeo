# Typed multimodal message parts

Romeo's public message contract has a versioned provider-neutral content-part
vocabulary. It is the compatibility boundary for multimodal persistence,
provider projection, realtime media, and artifact rendering; provider request
objects and inline binary payloads are not message-domain types.

## Version 1 vocabulary

`MessagePartSchema` is a strict discriminated union:

- `text` contains bounded Unicode text and an optional bounded BCP 47 language;
- `image_ref` references a Romeo file with an allowlisted raster media type,
  bounded dimensions, alt text, transform history, and provenance;
- `audio_ref` references bounded-duration audio and optional transcript/waveform
  resources;
- `video_ref` references bounded-duration/dimension video plus transcript and
  bounded keyframe resources;
- `document_ref` references an allowlisted document, safe filename, and optional
  inclusive page range;
- `tool_result_ref` references a tool call/result and only an explicitly bounded
  safe preview;
- `artifact_ref` references an immutable artifact version and allowlisted safe
  renderer mode;
- `citation_ref` references a source/document and optional chunk.

The ordered input container is `MessageContentSchema`. Public persisted output
uses `MessagePartOutputSchema`, which adds bounded `id`, `messageId`, `position`,
and `createdAt`; `MessageContentOutputSchema` contains the ordered output list.
The legacy `Message.content` projection remains additive-compatible while
`Message.parts` is optional during migration.

## Security and governance invariants

- Media/document parts accept Romeo identifiers, never URLs, data URLs, base64,
  object-store keys, or provider-native blobs.
- All objects are strict and bounded. Image/video pixels, audio/video duration,
  page selections, keyframes, text, previews, filenames, transforms, and list
  sizes have explicit contract ceilings.
- SVG is not an image-message media type. Renderers consume only allowlisted
  modes and must still authorize referenced resources at access time.
- Provenance is structured and bounded; it does not accept arbitrary provider
  metadata, secrets, prompts, or raw tool results.
- This contract does not itself grant access, declare a file clean, or make a
  selected provider capable. File lifecycle, malware/DLP policy, resource ACL,
  retention, capability resolution, and provider projection remain mandatory
  server-side boundaries.

## Persistence rollout

Migration `0026_typed_message_part_rollout.sql` evolves the existing normalized
`message_parts` table; no competing content-part table exists. New messages set
`messages.parts_schema_version = 1` and atomically write one ordered typed text
part when `content` is nonempty. Blank assistant/tool rows remain valid and do
not get an invalid empty text part. Legacy attachments and collaboration-channel
metadata stay in schema version 0 and retain their deterministic insertion order.

Reads are additive during rollout. Strict v1 rows are decoded fail-closed and
returned in `Message.parts`; a legacy row with nonempty `messages.content`
synthesizes the same text projection until it is backfilled. Legacy `content`,
`attachments`, and `citations` remain authoritative compatibility projections.
Portable v1 chat export/import intentionally continues using those legacy
fields, while the governed data export records strict typed rows with text
subject to the export content flag.

The internal stored text value carries a fixed `romeo-message-text-v1:` marker
that strict readers remove. During a rolling deployment an older reader may
classify an unknown typed row as a legacy attachment; the reserved marker keeps
its `content` outside Romeo's attachment-object key namespace, so cleanup cannot
mistake user text for an object-store key. Typed-row constraints require the
marker and reject an empty payload.

The schema migration does not scan or rewrite the message tables. Operators run
the restartable bounded worker after deployment:

```sh
pnpm --filter @romeo/db db:backfill-message-parts -- \
  --max-messages 100 --max-part-rows 2000 --max-batches 100
```

Each PostgreSQL batch claims at most 500 messages with `FOR UPDATE SKIP LOCKED`,
caps all touched part rows, obtains a per-message advisory transaction lock,
reindexes legacy duplicate positions by `(position, id)`, writes any missing
text part, then marks that message complete in one transaction. Exit code 0 and
`completed:true, remainingMessages:0` are the completion evidence. Exit code 2
means more batches or manual remediation are required; reads remain compatible
and the command never spins on a blocked row. Rolling the application back is
safe because old code ignores the additive columns and the insert trigger keeps
legacy writes in a collision-free canonical order.

Foreign-key cascades continue to govern message deletion and tenant purge, so
typed parts follow the same retention/legal-hold decision as their parent
message. Search and branch paging remain based on legacy `messages.content`
during this rollout. EP-07-03 through EP-07-05 own file lifecycle and
normalization, EP-07-06 owns adapter projection, and EP-07-07 owns persisted
provider output parts; this migration does not imply every model supports every
part kind.
