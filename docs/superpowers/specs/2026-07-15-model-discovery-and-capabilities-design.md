# Model Discovery & Per-Model Capabilities — Design

Date: 2026-07-15
Branch: `remediation/2026-07-15`
Status: approved (design), pending implementation plan

## 1. Goal

Bring Romeo's model handling up to (and slightly past) Open WebUI parity in two
areas the user asked for:

1. **Detect Ollama models with their real per-model capabilities** (tool-calling,
   vision, context window) instead of stamping one hardcoded capability object on
   every model.
2. **Add specific OpenAI-API-compatible models** — discover them from the
   endpoint's `GET /models`, or add specific model ids by hand when the endpoint
   has no `/models`.

Concrete bug this fixes as a side effect: a tool-less Ollama model (e.g.
`gemma3:4b`) currently gets a raw provider `http_400` because every Ollama model
is hardcoded `toolCalling: true` and the run path then sends provider tools. With
real detection, gemma reports no `tools` capability → the existing guard drops
tools → no 400. `llama3.2` reports `tools` → keeps them.

## 2. Key finding that shaped this design

Open WebUI does **not** auto-detect capabilities. Its `/api/show` route is a pure
passthrough proxy (`open-webui/backend/open_webui/routers/ollama.py:719-750`);
nothing reads Ollama's `capabilities` array. Discovery fetches the model **list**
only (`/api/tags`, and `GET /models` for OpenAI-compatible). Capabilities live in
each model's `meta.capabilities`, default to `true`, and are admin/user-editable
toggles (`open-webui/.../models/models.py:34-41`, editor
`.../workspace/Models/Capabilities.svelte`). Tool-calling there is a per-model
param `function_calling: 'native' | null`; default `null` means Open WebUI injects
tools via *prompt*, which is why it never 400s on a tool-less model.

Romeo already discovers the Ollama model *list*. So the real gaps are: (a) real
per-model capabilities + context window, (b) real OpenAI-compatible model
discovery (today it emits one synthetic `"gpt-compatible"` model), and (c) a UI to
edit capabilities/enable models/enter a credential.

**Decision:** hybrid — auto-detect capabilities as the *seed* (better than Open
WebUI, and it fixes gemma automatically), then let an admin override per-model.
Romeo has no prompt-based tool injection and adding one is out of scope, so
"toolCalling" continues to mean "send native provider tools", gated as today.

## 3. Decisions (locked with the user)

- **Capabilities:** hybrid — detect to seed, per-model admin override on top.
- **Scope:** full vertical slice, delivered in 3 verify-green phases (backend
  detection → API/persistence → UI), each its own reviewed commit.
- **OpenAI-compatible model entry:** both — sync fetches `GET /models`; a per-provider
  model-id allowlist, when set, is used instead and skips `/models` (covers
  endpoints without `/models`, e.g. some gateways/Azure). Mirrors Open WebUI.

## 4. Architecture (chosen approach)

Extend the existing adapters and reuse the persistence Romeo already has. Romeo
already models each connection as a provider *record* (`provider_instances`) and
persists discovered models as rows (`base_models`, with a `capabilities` jsonb and
an `enabled` flag). That is a cleaner substrate than Open WebUI's index-aligned
URL/key config arrays, so we keep it.

Rejected alternatives: (2) writing detected caps to the dormant
`provider_capabilities`/`discovered_at` table (`packages/db/src/schema/providers.ts:60-68`)
— adds a table + merge layer for no user-visible gain (YAGNI); (3) copying Open
WebUI's index-aligned config-array model — a needless departure from Romeo's
provider-record architecture.

## 5. Components

### A. Ollama adapter — `packages/providers/src/adapters/ollama.ts`

Today: `listModels` (`:26-43`) → `discoverOllamaModels` (`:134-162`) does a single
`GET /api/tags` (`:138`) and maps every model to the hardcoded `ollamaCapabilities`
(`:40`) + `contextWindow: 8192` (`:42`).

Change: after `/api/tags`, for each model call `POST {baseUrl}/api/show` with
`{ model: name }` and read:
- `capabilities: string[]` (Ollama ≥0.4, e.g. `["completion","tools","vision",...]`)
  → `toolCalling = caps.includes("tools")`, `vision = caps.includes("vision")`,
  modalities extended with `"vision"` when present.
- `model_info` context length — the key is family-prefixed
  (`llama.context_length`, `gemma.context_length`, …), so read the first key
  matching `/\.context_length$/` → `contextWindow`.

Fallbacks (no regression): if `/api/show` fails, times out, or returns no
`capabilities` field (older Ollama), keep today's `ollamaCapabilities` +
`contextWindow: 8192` for that model. Per-model `/api/show` calls run with bounded
concurrency (cap ~6) and a short timeout, each wrapped in `.catch`, so one slow/failed
model never fails discovery. Keep the existing empty-result fallback to `["llama3.2"]`
(`:30`) and the 100-model cap (`:31`).

### B. OpenAI-compatible adapters — `openai-compatible.ts` (+ `openai-responses-compatible.ts`)

Today: `listModels` (`openai-compatible.ts:27-39`) returns a single synthetic model
`model_${provider.id}_default`, never queries the endpoint.

Change:
- If the provider has a non-empty **model-id allowlist**, synthesize one `BaseModel`
  per listed id and skip the network call.
- Otherwise `GET {baseUrl}/models` (Bearer from the resolved credential), map each
  returned `data[].id` to a `BaseModel`. Filter obvious non-chat junk the way Open
  WebUI does for the official OpenAI endpoint (optional, low priority).
- Capabilities can't be read from `/models`, so seed the existing
  `openAiCompatibleCapabilities` (`capabilities.ts:3-16`) / `...Responses...` (`:18-21`);
  admin overrides per-model. `contextWindow` stays the current default (128000)
  unless the id is a known family — do not guess.
- Failure (network/auth/no `/models`) with no allowlist → return an empty list and
  surface the error through the existing sync path rather than a synthetic model.

### C. Persistence — reuse existing tables

- Detected caps + contextWindow write to `base_models` via the existing
  `upsertModels` (`packages/db/src/provider-repository.ts:129-163`, upsert on
  `base_models.id`; unique `(providerId, name)` at `schema/providers.ts:95`). The
  `capabilities` jsonb column already exists (`:70-100`) — no schema change for caps.
- Provider gains an optional `modelIds: string[]` allowlist. Smallest home: a
  column on `provider_instances` (jsonb, nullable) OR fold into a new provider
  `config` jsonb. **Decision:** add a nullable `model_ids` jsonb column to
  `provider_instances` (one focused migration). NOTE: Global Constraint check — Phase 2
  of the prior remediation forbade schema/migration churn for *core*; this is a new
  feature and a migration is expected. The plan must confirm the migration policy
  (Drizzle migration under `packages/db`) before writing it.
- Credentials already exist: `provider_instances.credentialRef` +
  `provider_credentials` table + the managed-secret flow (`provider-service.ts:72`
  `assertManagedSecretRef`). The UI simply never collected one. No new secret infra.

### D. API — `packages/core/src/http/routes/providers.ts`

Current surface: `GET /providers`, `GET /providers/operational-summary`,
`POST /providers`, `POST /providers/:id/sync`, `GET /models`, `PATCH /models/:id/pricing`.

Add:
- Credential + `modelIds` on `POST /providers` (extend `createProviderSchema`,
  `packages/core/src/http/schemas.ts:20-25`). Credential is entered as a secret and
  stored via the existing managed-secret path → `credentialRef`.
- `PATCH /providers/:id` to update `modelIds` / credential / name / baseUrl (there is
  no update-provider endpoint today).
- `PATCH /models/:id/capabilities` — admin override of a model's `capabilities`
  (validated against `ProviderCapabilities`). Sits beside the existing pricing PATCH.
- `PATCH /models/:id` (or `/models/:id/enabled`) — toggle a model's `enabled` flag
  (`base_models.enabled` exists; no endpoint sets it).

`POST /providers/:id/sync` is unchanged in shape and becomes the discovery trigger;
it now writes real capabilities.

### E. UI — `apps/app/src`

- `components/ProviderPanel.tsx` (form `:33-52`, fields `:182-247`): add an API-key
  field (currently absent — you cannot add a real OpenAI-compatible provider today)
  and an optional model-id list textarea. Wire through
  `api/provider-client.ts:createProvider` (`:27-38`) and `useAdminController.ts`.
- Model management: extend `components/ModelPricingPanel.tsx` (list `:14-40`, pricing
  edit `:42-71`) — or a sibling panel — to add a per-model `enabled` toggle and turn
  the read-only capability badges (`AgentDraftForm.tsx:339-355`) into editable toggles
  for the Romeo capability set (toolCalling, vision/modalities, structuredJson,
  reasoning, contextWindow). Keep pricing where it is.
- The existing "Sync models" button (`ProviderPanel.tsx:153-160`) stays the discovery
  action; after sync the model list shows real, per-model capabilities.

## 6. Capability mapping (detection → `ProviderCapabilities`)

Romeo's editable/effective capability shape (`packages/providers/src/types.ts:25-34`):
`streaming, toolCalling, vision, audioInput, structuredJson, reasoning, modalities[], deployment`.

Ollama `/api/show` → capability seed:
- `capabilities.includes("tools")` → `toolCalling`
- `capabilities.includes("vision")` → `vision` (+ add `"vision"`/`"image"` to `modalities`)
- `capabilities.includes("embedding")` → route to the embeddings adapter path (out of
  scope for chat discovery; note only)
- `*.context_length` in `model_info` → `contextWindow`
- `streaming` stays `true`; `deployment` stays local-runtime/local-http (unchanged).

OpenAI-compatible: no capability data available → seed the existing per-kind default,
admin overrides. `structuredJson`/`reasoning` stay per-kind defaults.

We do NOT adopt Open WebUI's 11 product capabilities (web_search, code_interpreter,
terminal, citations, …) — those are Open WebUI feature flags, not model capabilities,
and Romeo has no equivalent surfaces. YAGNI.

## 7. Data flow

Add/sync provider → adapter `listModels(provider)`:
- Ollama: `/api/tags` → per-model `/api/show` (bounded, best-effort) → `BaseModel[]`
  with detected caps + contextWindow.
- OpenAI-compatible: allowlist? synthesize : `GET /models` → `BaseModel[]` with default caps.
→ `provider-service.syncModels` → `repository.upsertModels` → `base_models` rows.

Admin edits a model → `PATCH /models/:id/capabilities` / `.../enabled` → updates the
`base_models` row (override wins; a later re-sync must NOT clobber an admin override —
see §8).

Run time (unchanged): `run-executor.ts:459-471 providerToolsForTarget` drops tools
unless both provider and model `capabilities.toolCalling === true`.

## 8. Error handling & edge cases

- `/api/show` unavailable / older Ollama / per-model failure → fall back to current
  hardcoded defaults for that model (no regression, no discovery failure).
- OpenAI `/models` missing/401/empty and no allowlist → empty list + surfaced error;
  do NOT emit a synthetic model (removing today's `"gpt-compatible"` is intended).
- **Re-sync vs. admin override (important):** `upsertModels` on conflict must not
  overwrite an admin-overridden `capabilities`. The plan must decide: either mark a
  row `capabilitiesOverridden` and skip caps on upsert, or upsert detected caps into a
  separate `detectedCapabilities` and keep `capabilities` as the effective override.
  Simplest: a boolean `capabilities_source: 'detected' | 'override'` guard on upsert.
- Embedding-only Ollama models must not appear as chat models (filter on capabilities).
- Concurrency/timeout on `/api/show` bounded so a large local model registry stays fast.

## 9. Testing strategy (TDD)

Per phase, write the failing test first, then implement.

- **Ollama adapter** (`packages/providers`): mock `/api/tags` + `/api/show`.
  - gemma3:4b (`capabilities: ["completion"]`) → `toolCalling === false`.
  - llama3.2 (`["completion","tools"]`) → `toolCalling === true`.
  - vision model (`["completion","vision"]`) → `vision === true`, modalities include vision.
  - `model_info` context length parsed into `contextWindow`.
  - `/api/show` 404/timeout → falls back to `ollamaCapabilities` + 8192.
- **OpenAI-compatible adapter:** mock `GET /models` → one model per id, default caps;
  allowlist set → uses ids, no network call; `/models` 401 + no allowlist → empty + error.
- **Run path lock-in** (`packages/ai-runtime` — mirror the positive case at
  `run-executor.test.ts:194-210`): a `toolCalling:false` model + non-empty tools →
  `seenInput.tools === undefined`.
- **Override round-trip** (`packages/core`): `PATCH /models/:id/capabilities` persists;
  a subsequent sync does not clobber it (per §8 decision).
- **Enable toggle** persists and is honored by the model list.
- Full gate each phase: `npx --yes pnpm@11.7.0 verify` EXIT 0. UI phase verified in the
  real app with Ollama running (llama3.2 keeps tools; gemma3:4b runs tool-free, no 400).

## 10. Phasing

1. **Backend detection** — Ollama `/api/show` enrichment + OpenAI-compatible `/models`
   discovery + allowlist synthesize, with adapter tests. No API/UI change yet; seed
   still works. Fixes the gemma class at the adapter level.
2. **API + persistence** — `model_ids` column + migration; credential + `modelIds` on
   create; `PATCH /providers/:id`; `PATCH /models/:id/capabilities`; enable toggle;
   re-sync/override guard (§8).
3. **UI** — credential + model-id fields on `ProviderPanel`; per-model enable toggle +
   editable capability toggles; real-app verification with Ollama.

## 11. Out of scope (YAGNI)

- Prompt-based tool injection (Open WebUI's `function_calling` fallback). Romeo sends
  native tools only; a tool-less model simply runs tool-free.
- The dormant `provider_capabilities`/`discovered_at` table.
- Open WebUI's index-aligned URL/key config arrays; multi-URL-per-record.
- Open WebUI product capabilities beyond Romeo's set (web_search, code_interpreter, …).
- Azure/Anthropic-specific `/models` branches (note the allowlist path already covers
  "no `/models`" endpoints); add later only if needed.

## 12. Open risks / notes for the plan

- Migration policy: prior remediation forbade *core* schema churn; this feature adds a
  `provider_instances.model_ids` column — confirm the Drizzle migration workflow under
  `packages/db` before writing it.
- Credential UX: entering an API key must create/reference a managed secret
  (`assertManagedSecretRef`), not store the raw key on the provider row.
- `/api/show` response shape varies by Ollama version; the `capabilities` array is
  ≥0.4 only — the fallback is load-bearing, test it.
- Re-sync must respect admin overrides (§8) — the single most likely correctness trap.
