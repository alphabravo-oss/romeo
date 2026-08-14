# Romeo Helm deployment policy

The chart is production-shaped and intentionally fails closed. A production
render must provide all of the following:

- `image.digest=sha256:...` for the exact published application manifest;
- `valkey.urlSecret.name` and `key` for distributed HTTP limiting and quota
  coordination;
- a deployment-specific `networkPolicy.egress` allowlist covering DNS,
  Postgres, Valkey, object storage, telemetry, and enabled providers;
- required malware scanning, non-root/read-only security contexts,
  dependency-aware readiness, and the pre-upgrade migration hook (the secure
  values defaults already enable these controls).

The egress entries in `networkpolicy-egress-values.example.yaml` are examples,
not production destinations. Replace every namespace, selector, and TEST-NET
CIDR with reviewed values for the target cluster.

High-risk capability emergency controls are operator-only. Set
`env.CAPABILITY_PLATFORM_DISABLED_IDS` to an exact comma-separated subset of
`realtime_voice`, `external_provider_use`, `secure_compute`,
`image_generation`, `image_editing`, `multi_model_compare`, and
`streamed_output_policy`. Unknown, duplicate, empty, or whitespace-padded
entries fail application startup. Safe defaults keep future high-risk classes
disabled while preserving the existing governed image-generation behavior;
an explicit empty value removes the platform deny, but unavailable features
remain unavailable through their other capability dimensions.

```sh
export ROMEO_IMAGE_DIGEST='sha256:<64 hex characters from the release manifest>'

helm upgrade --install romeo deploy/helm \
  --namespace romeo \
  --values deploy/helm/external-postgres-values.example.yaml \
  --values deploy/helm/networkpolicy-egress-values.example.yaml \
  --set-string image.digest="$ROMEO_IMAGE_DIGEST"
```

`imagePolicyException` is an audited development-only escape hatch for a
registry that cannot publish a digest. It requires an explicit reason and does
not bypass any other production invariant. Do not use it for a release.

Run the local deployment gates before publishing:

```sh
pnpm check:helm-production-policy
pnpm check:container-image-policy
```

The second command requires a running Docker engine. Use
`node scripts/container-image-policy.mjs --static-only` only for environments
that cannot run image builds; release validation must run the full command.
