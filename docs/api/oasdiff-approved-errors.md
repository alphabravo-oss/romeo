# OpenAPI compatibility policy

No breaking compatibility exceptions are currently approved. The executable,
fingerprint-bound source of truth is
`docs/api/openapi-compatibility-ledger.json`; reviewed non-breaking warnings are
recorded there with ownership, rationale, documentation, and review expiry.

The 2026-07-18 baseline starts Romeo's contract-first compatibility epoch after
the approved pre-release rewrite replaced the incomplete handwritten OpenAPI
mirror with schemas generated from runtime route contracts. Future breaking
changes must be reviewed individually and recorded in that ledger; the baseline
must not be refreshed merely to make CI pass. This historical note is not an
`oasdiff --err-ignore` input and cannot suppress the release gate.
