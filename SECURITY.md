# Security policy

## Supported versions

Romeo is currently alpha software. Security fixes are applied to the latest
commit on `main` and the latest published `0.1.x` release only. Older commits,
development snapshots, and locally modified deployments are not supported.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting form:

https://github.com/alphabravo-oss/romeo/security/advisories/new

Include affected versions, impact, reproduction steps, relevant configuration,
and a minimal proof of concept. Do not include production credentials, personal
data, or data belonging to another tenant.

Maintainers will acknowledge a report within three business days, provide a
triage update within seven business days, and coordinate remediation and
disclosure based on severity. Please allow a reasonable remediation window
before public disclosure.

## Security expectations

- Never commit credentials. Rotate any credential that may have entered Git,
  even when scanning later reports it as removed.
- Report tenant-boundary, authorization, cryptographic, supply-chain, and data
  exposure issues through the private channel above.
- Test only systems and data you own or have explicit authorization to test.
- Dependency, secret, SAST, filesystem, and image findings are release blockers
  unless maintainers document a time-bounded risk acceptance.
