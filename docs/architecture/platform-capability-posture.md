# Platform capability posture

The platform layer is Romeo's absolute capability ceiling. It is controlled by
the self-hosted operator through validated deployment configuration, not by a
tenant mutation endpoint.

`GET /api/v1/admin/capabilities/platform` gives a global administrator a
read-only view derived from the same capability definition registry and
platform policy used at action time. It returns the registry version and, for
each registered capability, only its lifecycle, risk, enabled/disabled state,
and the bounded reason `allowed` or `platform_disabled`.

The route requires `capabilities:read` and the `global_admin` role. Organization
administrators do not receive the posture, and no caller receives raw
environment values, unregistered kill-switch identifiers, secrets, endpoints,
or tenant data. There is deliberately no write route: operators change the
validated deployment environment and redeploy. Organization and workspace
assignments may tighten this ceiling but can never loosen it.

The administration UI renders this section only for a global administrator,
labels it as deployment-controlled and read-only, and keeps organization
rollout flags and organization/workspace policy assignments in their own
sections. This prevents a tenant control from appearing able to override a
platform deny.

Validation includes strict contract parsing, global-versus-organization admin
authorization, platform-deny precedence, privacy sentinels, generated client
drift, localized component output, and the normal capability resolver/action
tests.
