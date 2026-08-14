# Runtime prerelease risk acceptance

Risk ID: VER-02

Status: Accepted

Owner: @mjtechguy

Review by: 2026-11-13

## Scope and rationale

The application runtime currently depends on `nitro@3.0.260610-beta`. That
release resolves prerelease runtime packages including h3, ofetch, unenv, and
unstorage. Romeo accepts this bounded compatibility risk while the current
TanStack Start integration remains on the Nitro 3 line; this is not permission
to float to later prereleases or to add unrelated prerelease dependencies.

## Compensating controls

- The direct Nitro version is exact in `apps/app/package.json`, and the
  lockfile retains package integrity hashes.
- CI rejects ranged direct prerelease dependencies and an expired acceptance.
- New dependency releases are quarantined for at least 24 hours, with only
  exact-version, reviewed exceptions.
- Dependency, SAST, filesystem, secret, and serving-image scans are release
  gates; application checks and deployment smokes cover the built runtime.
- Release images are immutable and rollback uses the previously reviewed image
  digest rather than reinstalling dependencies.

## Exit criteria

Before the review date, the owner must either move Romeo to a supported stable
runtime compatible with TanStack Start or renew this acceptance after reviewing
the resolved prerelease graph, vulnerability evidence, upgrade tests, and
rollback evidence. Any Nitro version change requires updating this record in
the same reviewed change.
