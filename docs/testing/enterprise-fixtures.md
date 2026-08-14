# Enterprise AI fixture corpus

Romeo's shared enterprise fixture corpus lives at
`test/fixtures/enterprise-ai-fixtures.json`. It is deliberately synthetic,
small, deterministic, and safe to copy into CI evidence. The same versioned
manifest is consumed by the in-memory core tests and the PostgreSQL repository
conformance suite.

The corpus covers six boundaries that otherwise tend to drift into unrelated
one-off test data:

- model capability truth, including text/reasoning and multimodal declarations;
- bounded image, audio, and document payloads with exact bytes and checksums;
- direct, group, missing-grant, cross-organization, and cross-workspace ACLs;
- ordered resumable streaming with an explicit terminal event and replay cursor;
- synthetic DLP detections assembled from segments so the repository never
  contains a usable secret; and
- network-disabled compute with hard CPU, memory, time, output, and artifact
  ceilings plus a deterministic expected digest.

## Rules

1. Fixture IDs start with `fx_`; they must never overlap production or seeded
   development identities.
2. Media payloads are decoded and hashed by the fixture policy gate. Payloads
   are capped at 1 MiB and may not contain active content or remote references.
3. DLP examples remain split into inert segments. Tests may join them only in
   process and must never print the joined value or include it in evidence.
4. Every ACL corpus includes positive direct/group cases and negative missing,
   cross-organization, and cross-workspace cases.
5. Streaming sequences start at one, are contiguous, contain exactly one final
   terminal event, and declare the expected cursor replay.
6. Compute fixtures are network-disabled and bounded. They are inputs for
   sandbox contracts; they are never executed directly by the fixture checker.
7. The manifest contains no credentials, private keys, routable endpoints,
   customer content, prompts, provider outputs, or protected source text.

Run `pnpm check:enterprise-test-fixtures` after editing the corpus. The command
validates the manifest and executes adversarial self-tests that prove unsafe
secret, media, ACL, stream, and compute mutations are rejected. Package tests
then prove the same fixture version and cases behave in memory and PostgreSQL.
