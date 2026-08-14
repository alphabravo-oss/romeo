# Romeo SDK policy

**Status:** Accepted  
**Applies to:** public `/api/v1` REST and SSE contracts

Romeo publishes one OpenAPI contract and derives its supported TypeScript and Python
clients from that artifact. A route is not complete when only a handwritten UI wrapper
can call it.

## Required surfaces

| Capability                  | TypeScript                                                              | Python                                                                                    | Rule                                                                             |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| REST command/query          | Generated SDK operation and strict types                                | Generated client operation and strict types                                               | Required for every public non-browser-only route                                 |
| Durable SSE                 | Generated/request helper with `AbortSignal` and async event consumption | `stream_run_events`-style iterator with cursor support                                    | Required; event schema/version remains in the public contract                    |
| Upload/download preparation | Generated REST operations                                               | Generated REST operations                                                                 | Binary transfer may use signed URLs, but authorization commands remain generated |
| Browser-only realtime media | Separate explicitly named browser runtime export                        | Negotiation/control REST operations only unless a portable realtime client is implemented | Must never appear as a normal portable SDK operation by accident                 |
| Internal worker/ops route   | Generated only when part of the documented public worker contract       | Same                                                                                      | Otherwise keep it outside the public OpenAPI document                            |

## Compatibility rules

1. The in-repository OpenAPI document is the source for both generators.
2. Public v1 changes are additive during the compatibility window. Renames are additive
   aliases followed by the API deprecation process, not in-place changes.
3. Operation IDs, discriminators, cursor/event versions, error codes, nullability, and
   optionality are contract behavior. A generator succeeding does not make a breaking
   change acceptable.
4. Generated code is not hand-edited. Runtime behavior such as base URL, credentials,
   CSRF, `AbortSignal`, and safe error handling lives in reviewed adapters outside the
   generated tree.
5. SSE consumers tolerate unknown additive event types while never executing unknown
   content. Reconnect cursors are explicit and cancellation reaches the network request.
6. Browser-only helpers must live under an explicit browser/realtime export and be
   documented as unavailable in server/Python runtimes. Their negotiation, policy, and
   durable history APIs remain generated where applicable.
7. Examples and fixtures contain no credentials, tenant data, raw provider errors, or
   hidden reasoning.

## Release gates

- `pnpm contract:lint`
- `pnpm contract:breaking`
- `pnpm check:openapi-route-coverage`
- `OPENWEBUI_COMPATIBILITY_ENABLED=true pnpm check:openapi-route-coverage`
- `pnpm check:sdk-typescript-drift`
- `pnpm check:sdk-drift`
- TypeScript API-client tests, Python client tests, and browser SSE acceptance

The quality workflow and hosted CI run these gates. A generated diff is reviewed with
the contract change that caused it; committed generated output is not evidence by
itself. Credentialed live provider/media tests remain release-target evidence, not a
reason to omit deterministic SDK contract tests.

## Adding an operation

1. Define the strict schema, stable operation ID, documented authorization, public
   errors, and additive event/cursor behavior.
2. Register the deployed route and make route/OpenAPI coverage green.
3. Regenerate TypeScript and Python outputs from the same exported document.
4. Add SDK-level cancellation, serialization, response, and error tests where the
   operation introduces a new shape or transport behavior.
5. Run every release gate above and record any environment-bound acceptance separately.
