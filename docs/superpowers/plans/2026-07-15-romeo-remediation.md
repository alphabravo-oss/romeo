# Romeo Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Romeo under version control, make `pnpm verify` honestly green, delete ~18K lines of unreachable compliance scaffolding, and close the chat UX gaps that make the product unusable day-to-day.

**Architecture:** Romeo is a pnpm workspace. `packages/core` owns domain + services + Hono HTTP; it defines a `RomeoRepository` contract and deliberately does *not* depend on `packages/db`. `apps/app` (TanStack Start + React) composes the driver at the edge (`apps/app/src/server/romeo-api.ts:20-33`) and mounts the API under a catch-all route. This plan does not change that architecture — it removes dead weight from it and finishes the product surface on top of it.

**Tech Stack:** pnpm 11.7.0 workspaces · TypeScript 6 · Hono + `@hono/zod-openapi` · Zod 4 · Drizzle/Postgres · TanStack Start/Router/Query/Table/Virtual · Vitest 4 · React 19

---

## Global Constraints

- **Package manager:** `pnpm@11.7.0` exactly (pinned in `package.json` `packageManager`). It is **not installed on the current machine** — every command in this plan uses `npx --yes pnpm@11.7.0` until Task 0.2 fixes this. After Task 0.2, plain `pnpm` works.
- **Node:** v24.15.0 (current local). Do not add a Node version floor without checking `deploy/compose/Dockerfile`.
- **No new runtime dependencies** without an explicit callout. Every task in this plan is achievable with what is already installed.
- **Forward-only migrations.** Per `README.md`, the greenfield baseline is locked at `packages/db/migrations/0000_greenfield_baseline.sql`. **No task in this plan touches the DB schema.** If one appears to need to, stop and escalate.
- **`core` must never import `@romeo/db`.** This is deliberate dependency inversion, not an oversight. Do not "fix" it.
- **Naming:** Romeo naming throughout (package scope `@romeo/*`, CLI `romeo`). Open WebUI is a UX reference only — do not copy its code.
- **Commit trailer:** every commit ends with:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```

---

## Reasoning: why this plan, in this order

This section exists because the sequencing is not arbitrary and a future reader will otherwise re-litigate it.

### Finding 1 — There is no version control. This dominates everything.

```
$ git status
fatal: not a git repository (or any of the parent directories): .git
```

334,040 lines of TypeScript with no history, no branches, no blame, no revert. Every other item on this list is recoverable; this one is not. **Phase 0 blocks all other phases** — in particular, Phase 2 deletes ~18K lines, which is indefensible without a commit to revert to.

### Finding 2 — `pnpm verify` fails, but *not for the reason it appears to*.

The build reports 3 failures out of 545 in `packages/core`. My initial review called the first one "a real atomicity bug in a security path." **That was wrong.** I diagnosed all three to root cause:

| Test | Apparent cause | **Actual root cause** |
|---|---|---|
| `transaction-boundaries.test.ts:3483` "rolls back revoke-other local sessions as one batch when audit fails" | Session revocation doesn't roll back | **Rotted fixture.** `seedLocalSession` hardcodes `expiresAt: "2026-07-08T12:00:00.000Z"`. Today is 2026-07-15. `revokeOthers` skips expired sessions (`session-service.ts:857`), so all 3 seeded sessions are skipped → returns `[]` → audit never fires → nothing throws. **Production code is correct.** |
| `api.test.ts:1811` "reports sanitized edge security posture and applies security headers" | Edge security broken | **Non-hermetic test.** Sets `HTTP_RATE_LIMIT_DRIVER: "valkey"`; nothing listens on `localhost:6379`; `rate-limit.ts:264` throws `ApiError(..., 503)`. |
| `api.test.ts:2038` "reports GA-aligned edge enforcement failure codes" | Same | Same. Exactly 2 occurrences of `HTTP_RATE_LIMIT_DRIVER: "valkey"` exist in the file — precisely the 2 failing tests. |

I verified the fixture hypothesis empirically rather than by inspection: temporarily changing `2026-07-08` → `2099-07-08` makes the test pass, and I restored the file afterward.

**Conclusion: `pnpm verify` contains zero real product bugs.** It has one fixture that rotted a week after it was written and two tests that need a service dependency they never declared. This is good news and it changes the priority — Phase 1 is cheap.

It is also a *systemic* signal. There are **705 hardcoded mid-2026 date literals** across the test suite and **29** `expiresAt: "20…"` fixtures. Most are inert data, but any date fed into an expiry comparison is a time bomb with a lit fuse. Task 1.3 installs a guard so this class of failure cannot silently return.

### Finding 3 — ~18K lines of the codebase is a self-grading compliance apparatus.

24 `*-posture-service.ts` files. I verified the pattern directly rather than trusting a summary:

- `kubernetes-posture-service.ts` imports `node:fs/promises` and **nothing else** — no Kubernetes client. It reports "Kubernetes posture" without ever contacting a cluster.
- Every posture service is the same function: read env var → `readFile` → `JSON.parse` → check `schemaVersion` → echo fields back with a `status` verdict.
- The central security guarantee, `network-partition-posture-service.ts:522`, is a function returning hardcoded `false` literals — typed as literal `false`, so it is compile-time incapable of being anything else. It is an API asserting "I did not leak secrets" by hardcoding that it didn't.
- **Every evidence path ships as `""`** — `.env.example`, `deploy/compose/compose.yml`, `deploy/helm/values.yaml:168-180`. The `ready` verdict these lines compute has never been reachable in any committed configuration.
- The tests write the fixture, then assert the response matches the fixture — verifying that `JSON.parse` works.
- **17 of 19 posture endpoints have zero callers.**

Dependency analysis says the removal is clean. Only two survivors have real consumers:

- `ga-evidence-posture-service` ← `readiness-service.ts:32-34` **and** the admin UI.
- `postgres-operational-posture-service` ← the admin UI (`apps/app/src/api/posture-client.ts:19`).

Every other posture service is referenced **only** by the barrel `packages/core/src/services/index.ts`. That is what makes Phase 2 a deletion rather than a refactor.

### Finding 4 — The product surface is inverted, but the foundation under it is real.

222 services / 66 route files / 73 tables behind **6 frontend routes**. ~85% of component code is admin console; ~7% is end-user surface. The largest component in the app is `AuthProvidersPanel.tsx` (1,139 lines) — 3.6× the chat panel.

But the chat loop genuinely works: real SSE token streaming, real `AbortController` cancel, markdown + code highlighting, image attachments, voice in/out, all against real OpenAI-compatible and Ollama adapters. `apps/app/src/styles/app.css` is 2,648 lines of a real design system. I booted it and confirmed.

So Phase 3 is not "build a chat product." It is closing a small number of specific gaps in a product that already runs. Crucially, **`updateChat` and `archiveChat` already exist** in `apps/app/src/api/chat-client.ts:65-99` with backend routes behind them. Rename and delete are pure UI wiring — no backend work at all.

### Ordering

```
Phase 0 (preserve)  ──blocks──▶  Phase 1 (green)  ──blocks──▶  Phase 2 (delete)  ──▶  Phase 3 (product)
```

- Phase 0 first: never delete 18K lines without a revert point.
- Phase 1 before Phase 2: you cannot tell whether a deletion broke something if the suite was already red. A green baseline is what makes Phase 2 safe.
- Phase 2 before Phase 3: Phase 3 touches `services/index.ts` and `api.ts` adjacently; do the big mechanical removal first so Phase 3's diffs stay readable.
- Phase 4 is decisions, not tasks. It is deliberately not written as tasks because the inputs are business calls, not engineering ones.

### What this plan deliberately does NOT do

- **Does not fix the schema, migrations, or the `core`/`db` split.** They're correct.
- **Does not touch `openwebui-compatibility-service.ts` (3,352 lines).** It's the biggest single file and its value depends entirely on the Phase 4 strategy decision. Deleting or extending it before that decision is waste.
- **Does not add i18n, image generation, artifacts, or notes.** See Phase 4 — these are large, and which (if any) matter is a product call.
- **Does not restructure the admin console.** It's ugly in proportion but it works, and churn there buys nothing.

---

## File Structure

Files created or modified by this plan, and what each is responsible for.

| File | Phase | Responsibility |
|---|---|---|
| `.gitignore` | 0 | Already exists (95 bytes) — audited and extended before first commit |
| `package.json` | 0, 2 | `packageManager` pin already correct; Phase 2 prunes dead scripts |
| `packages/core/src/transaction-boundaries.test.ts` | 1 | Session fixture made relative to now |
| `packages/core/src/api.test.ts` | 1, 2 | Valkey tests made hermetic; posture echo-tests removed |
| `packages/core/src/test-support/fixture-clock.ts` | 1 | **New.** Single source of relative fixture dates + the rot guard's target |
| `packages/core/src/test-support/fixture-clock.test.ts` | 1 | **New.** Proves the guard catches a rotted fixture |
| `packages/core/src/services/*posture*.ts` | 2 | 22 of 24 deleted; 2 survivors kept |
| `packages/core/src/http/routes/*posture*.ts` | 2 | 17 of 19 deleted |
| `packages/core/src/http/openapi/*posture*.ts` | 2 | Matching OpenAPI paths/components deleted |
| `packages/core/src/services/index.ts` | 2 | Barrel exports pruned |
| `packages/core/src/api.ts` | 2 | Route registrations pruned |
| `packages/config/src/index.ts` | 2 | Dead evidence-path env vars removed |
| `deploy/helm/values.yaml`, `deploy/compose/compose.yml`, `.env.example` | 2 | Dead evidence env vars removed |
| `apps/app/src/components/ChatPanel.tsx` | 3 | Autoscroll anchor + autogrow composer + regenerate action |
| `apps/app/src/components/useWorkspaceController.ts` | 3 | `regenerateLast` + chat mutation handlers |
| `apps/app/src/components/WorkspaceNav.tsx` | 3 | Chat rename/delete affordances |
| `apps/app/src/lib/use-stick-to-bottom.ts` | 3 | **New.** Scroll-anchoring hook |

---

# Phase 0 — Preserve

**Why first:** everything downstream is destructive or refactoring. Without a revert point, a bad Phase 2 is unrecoverable.

**Phase Definition of Done:**
- `git log` shows at least one commit containing the full working tree.
- `git status` reports a clean tree.
- No secret, `node_modules`, `dist`, or `tmp` content is tracked.
- `pnpm --version` prints `11.7.0` without `npx`.

---

### Task 0.1: Initialize version control

**Files:**
- Modify: `/Users/mj/mjcode/ab/ab-live-products/romeo/romeo/.gitignore`
- Create: git repository at `/Users/mj/mjcode/ab/ab-live-products/romeo/romeo/.git`

**Interfaces:**
- Consumes: nothing.
- Produces: a git repo at the workspace root. Every later task's "Commit" step depends on this and on nothing else.

- [ ] **Step 1: Confirm the starting state**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git status
```

Expected: `fatal: not a git repository (or any of the parent directories): .git`

If this prints anything else, **stop** — a repo already exists and this plan's premise is wrong. Escalate.

- [ ] **Step 2: Read the existing .gitignore before trusting it**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
cat .gitignore
```

It is only 95 bytes. Confirm it covers `node_modules`, `dist`, and `.env`. It does **not** currently cover `tmp/` or `.output/`, both of which exist in the working tree.

- [ ] **Step 3: Extend .gitignore**

Append these lines to `.gitignore` (keep the existing contents — do not overwrite):

```gitignore

# Build + runtime output
.output/
tmp/
release/
*.tsbuildinfo

# Python artifacts (sdks/python ships a real client; its bytecode must not be tracked)
__pycache__/
*.py[cod]

# Local env + secrets (keep .env.example tracked)
.env
.env.*
!.env.example

# OS noise
.DS_Store
```

- [ ] **Step 4: Initialize the repo and stage everything**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git init
git add -A
```

- [ ] **Step 5: Audit what is about to be committed — do NOT skip this**

This is the one irreversible-in-spirit step: secrets committed to git history are permanent. Verify before committing.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
echo "--- staged file count ---"
git diff --cached --name-only | wc -l
echo "--- anything that should never be tracked? (expect ZERO lines) ---"
git diff --cached --name-only | grep -E "node_modules/|/dist/|^tmp/|^\.output/|^\.env$|\.pem$|\.key$|id_rsa" || echo "CLEAN"
echo "--- largest staged files ---"
git diff --cached --name-only | xargs -I{} du -k {} 2>/dev/null | sort -rn | head -5
```

Expected: the grep prints `CLEAN`. If it prints any path, fix `.gitignore`, run `git rm -r --cached <path>`, and re-run this step until it prints `CLEAN`.

- [ ] **Step 6: Scan staged content for secrets**

Scan for **real credential formats and high entropy**, not for the word "secret". This codebase is full of synthetic fixtures like `apiKey: "provider-api-key"`, `SECRET_PREFLIGHT_API_KEY`, and `xoxb-secret-slack-token`; a keyword scan drowns in them. Real credentials have recognisable prefixes or entropy, and those are what matter.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
echo "--- provider token formats, JWTs, private keys ---"
git diff --cached -- . ':(exclude)pnpm-lock.yaml' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' \
  | grep -inE "sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[0-9]{9,}-|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY" \
  | head -10 || true
echo "--- high-entropy strings (>=32 base64 chars) outside tests/lockfile ---"
git diff --cached -- . ':(exclude)pnpm-lock.yaml' ':(exclude)**/*.test.ts' ':(exclude)**/*.test.tsx' \
  | grep -oE "['\"][A-Za-z0-9+/]{32,}={0,2}['\"]" | sort -u | head -5 || true
echo "--- SCAN COMPLETE: any lines above (other than URL paths) are blockers ---"
```

Expected: no credential-format hits, and the entropy scan returns only long URL paths (e.g. `"/api/v1/admin/impersonation/requests"`), which are not secrets.

**Any real hit must be reviewed by a human before Step 7.** Do not broaden the exclusions to make a hit disappear.

> **Why not a keyword scan.** The first version of this step grepped for `(api_key|secret|password|token): "…"` and excluded lines containing the word `test`. It produced **37 false positives and zero true positives**, because the fixtures live in files named `*.test.ts` while the *lines* never contain the word "test". Every hit was a self-describing placeholder (`provider-api-key`, `gcp-access-token`, the xkcd `correcthorsebattery`) or a Kubernetes Secret **resource name** (`romeo-worker-api-key` — a name, not a value). Excluding by filename and matching on format/entropy is what actually distinguishes a credential from a fixture.

- [ ] **Step 7: Commit the baseline**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git commit -m "$(cat <<'EOF'
chore: initialize version control at current working tree

Baseline commit of the Romeo workspace. No code changes — this captures
the tree exactly as it stood before remediation so that subsequent
deletions have a revert point.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Verify**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git log --oneline
git status --short | head
```

Expected: one commit listed; `git status --short` prints nothing (clean tree).

- [ ] **Step 9: Create the working branch**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git checkout -b remediation/2026-07-15
```

Expected: `Switched to a new branch 'remediation/2026-07-15'`

**Task Definition of Done:**
- `git log --oneline` shows the baseline commit.
- `git status` is clean.
- The audit greps in Steps 5 and 6 print `CLEAN` / `NO OBVIOUS SECRETS`.
- Current branch is `remediation/2026-07-15`.

---

### Task 0.2: Make the pinned toolchain actually runnable

**Files:**
- Modify: `/Users/mj/mjcode/ab/ab-live-products/romeo/romeo/README.md`

**Interfaces:**
- Consumes: the git repo from Task 0.1.
- Produces: a working `pnpm` on PATH at 11.7.0. Every later task uses bare `pnpm`.

**Context:** `package.json` already pins `"packageManager": "pnpm@11.7.0"` — the pin is correct and must not change. The problem is purely local: the machine's pnpm shim tries to switch to 11.7.0 and fails with `ENOENT`. `npx --yes pnpm@11.7.0 --version` correctly prints `11.7.0`, so the version exists and is fetchable. Corepack is the standard fix and requires no repo change.

- [ ] **Step 1: Reproduce the failure**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm --version
```

Expected: `ERROR Failed to switch pnpm to v11.7.0. Looks like pnpm CLI is missing at ... ENOENT`

- [ ] **Step 2: Activate the pinned version via corepack**

```bash
corepack enable
corepack prepare pnpm@11.7.0 --activate
```

- [ ] **Step 3: Verify the fix**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm --version
```

Expected: `11.7.0`

If corepack is unavailable or still fails, fall back to `npm i -g pnpm@11.7.0` and re-run this step. If **that** fails, every command in this plan still works by substituting `npx --yes pnpm@11.7.0` for `pnpm` — record that in the README note below and continue. Do not change the `packageManager` pin to work around a local environment problem.

- [ ] **Step 4: Document it so the next person doesn't lose an hour**

In `README.md`, directly beneath the `## Local Development` heading, insert:

```markdown
This repository pins `pnpm@11.7.0` via the `packageManager` field. If `pnpm`
reports `Failed to switch pnpm to v11.7.0 ... ENOENT`, activate the pinned
version once:

```bash
corepack enable && corepack prepare pnpm@11.7.0 --activate
```

Every command below then works as written. Without it, prefix each command
with `npx --yes pnpm@11.7.0`.
```

- [ ] **Step 5: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add README.md
git commit -m "$(cat <<'EOF'
docs: record corepack activation for the pinned pnpm version

pnpm@11.7.0 is pinned but not installed by default; the shim fails with
ENOENT. Document the one-time corepack activation rather than weakening
the pin.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- `pnpm --version` prints `11.7.0` with no error.
- `package.json` `packageManager` is **unchanged** at `pnpm@11.7.0`.
- README documents the activation step.

---

# Phase 1 — Make verify honestly green

**Why:** Phase 2 deletes 18K lines. A red baseline makes it impossible to attribute a new failure to the deletion. Green first, then cut.

**Why "honestly":** the temptation is to delete or `.skip` the three failing tests. Two of them (edge security) are among the few tests in the posture area that assert real middleware behavior — security headers actually being applied. They are worth keeping. Fix them properly.

**Phase Definition of Done:**
- `pnpm verify` exits 0.
- `packages/core` reports `545 passed`, `0 failed` (plus the new tests from Task 1.3).
- No test was deleted, skipped, or weakened to achieve this.
- Re-running the suite on a machine with the clock set one year forward still passes.

---

### Task 1.1: Fix the rotted session fixture

**Files:**
- Create: `packages/core/src/test-support/fixture-clock.ts`
- Modify: `packages/core/src/transaction-boundaries.test.ts:4572-4573` (the `seedLocalSession` helper, defined at `:4560`) and `:3106-3107` (the inline `session_disable_rollback` fixture)

**Interfaces:**
- Consumes: nothing.
- Produces: `fixtureFuture(ms?: number): string` and `fixturePast(ms?: number): string` from `packages/core/src/test-support/fixture-clock.ts`. Task 1.2 and Task 1.3 both import from this module.

**Root cause (verified empirically, not inferred):** `seedLocalSession` hardcodes `expiresAt: "2026-07-08T12:00:00.000Z"`. `SessionService.revokeOthers` (`packages/core/src/services/session-service.ts:857`) skips expired sessions:

```ts
if (new Date(session.expiresAt).getTime() <= Date.now()) continue;
```

Today is 2026-07-15, so every seeded session is skipped, `revokedAt` is never written, the audit hook never fires, and the promise resolves to `[]` instead of rejecting. The sibling test `revoke()` passes because the targeted path does not filter on expiry. Changing the literal to `2099-07-08` makes the test pass — confirmed by running it.

**Why a shared helper rather than editing two literals:** there are 705 hardcoded mid-2026 date literals across the suite and 29 `expiresAt` fixtures. A one-off edit fixes today's symptom and leaves the class of bug in place. The helper is 12 lines and gives Task 1.3 something to enforce.

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/test-support/fixture-clock.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fixtureFuture, fixturePast } from "./fixture-clock";

describe("fixture clock", () => {
  it("returns an ISO timestamp in the future", () => {
    expect(new Date(fixtureFuture()).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns an ISO timestamp in the past", () => {
    expect(new Date(fixturePast()).getTime()).toBeLessThan(Date.now());
  });

  it("honours an explicit offset", () => {
    const oneHour = 60 * 60 * 1000;
    const actual = new Date(fixtureFuture(oneHour)).getTime();
    expect(actual).toBeGreaterThan(Date.now() + oneHour - 5_000);
    expect(actual).toBeLessThan(Date.now() + oneHour + 5_000);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/test-support/fixture-clock.test.ts
```

Expected: FAIL — `Failed to resolve import "./fixture-clock"`

- [ ] **Step 3: Write the minimal implementation**

Create `packages/core/src/test-support/fixture-clock.ts`:

```ts
// Fixture timestamps must be relative to now. A hardcoded future date is a
// time bomb: `expiresAt: "2026-07-08T12:00:00.000Z"` silently rotted a week
// after it was written and broke SessionService.revokeOthers tests, because
// revokeOthers skips expired sessions and so never reached the audit hook.
// ponytail: plain Date math, no fake-timer framework — add one only if a test
// needs to control the clock rather than just stay ahead of it.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function fixtureFuture(offsetMs: number = ONE_DAY_MS): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export function fixturePast(offsetMs: number = ONE_DAY_MS): string {
  return new Date(Date.now() - offsetMs).toISOString();
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/test-support/fixture-clock.test.ts
```

Expected: `Test Files 1 passed (1)`, `Tests 3 passed (3)`

- [ ] **Step 5: Confirm the real failure before fixing it**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/transaction-boundaries.test.ts -t "rolls back revoke-other local sessions as one batch when audit fails"
```

Expected: FAIL — `AssertionError: promise resolved "[]" instead of rejecting`

- [ ] **Step 6: Fix the fixture**

In `packages/core/src/transaction-boundaries.test.ts`, add to the existing imports at the top of the file:

```ts
import { fixtureFuture, fixturePast } from "./test-support/fixture-clock";
```

There are exactly **two** rotted session fixtures in this file. Both must change.

**Site 1 — the `seedLocalSession` helper** (defined at line **4560**; the literals are at **4572-4573**). Replace:

```ts
    expiresAt: "2026-07-08T12:00:00.000Z",
    createdAt: "2026-07-07T12:00:00.000Z",
```

with:

```ts
    expiresAt: fixtureFuture(),
    createdAt: fixturePast(),
```

**Site 2 — the inline `session_disable_rollback` fixture** (lines **3106-3107**, inside a `repository.createUserSession({...})` call). Replace:

```ts
      expiresAt: "2026-07-08T12:00:00.000Z",
      createdAt: "2026-07-07T12:00:00.000Z",
```

with:

```ts
      expiresAt: fixtureFuture(),
      createdAt: fixturePast(),
```

Note the indentation differs between the two sites (4 spaces vs 6) — match the surrounding code at each.

Verify both `expiresAt` sites are done:

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
grep -n 'expiresAt: "2026-07-08T12:00:00.000Z"' packages/core/src/transaction-boundaries.test.ts || echo "BOTH REPLACED"
```

Expected: `BOTH REPLACED`

> Do **not** blanket-replace `createdAt: "2026-07-07T12:00:00.000Z"` across the file. It appears **8 times**; only the two adjacent to a session `expiresAt` (lines 3107 and 4573) are part of this fix. The other six are inert payload data — a `createdAt` is never compared against `Date.now()`, so it cannot rot. Changing them is churn.

- [ ] **Step 7: Run the test and make sure it passes**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/transaction-boundaries.test.ts
```

Expected: `Test Files 1 passed (1)` — all tests in the file pass, including the previously failing one.

- [ ] **Step 8: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add packages/core/src/test-support/fixture-clock.ts \
        packages/core/src/test-support/fixture-clock.test.ts \
        packages/core/src/transaction-boundaries.test.ts
git commit -m "$(cat <<'EOF'
fix(test): make session fixtures relative to now

seedLocalSession hardcoded expiresAt: 2026-07-08, which passed when written
and rotted a week later. revokeOthers skips expired sessions, so all seeded
sessions were skipped, the audit hook never fired, and the rollback test's
promise resolved to [] instead of rejecting.

The production code was correct. Only the fixture was wrong.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- `pnpm exec vitest run src/transaction-boundaries.test.ts` passes fully.
- Neither `expiresAt: "2026-07-08T12:00:00.000Z"` occurrence remains (Step 6 prints `BOTH REPLACED`).
- Exactly **6** `createdAt: "2026-07-07T12:00:00.000Z"` literals remain untouched. Other hardcoded `2026-07-0*` dates (`archivedAt`, `updatedAt`, and the six inert `createdAt`s) are **expected to remain** — they are never compared against `Date.now()` and cannot rot. Only `expiresAt` is in scope.
- `SessionService` source is **unmodified** — the fix is confined to test fixtures.

---

### Task 1.2: Make the Valkey-dependent tests hermetic

**Files:**
- Modify: `packages/core/src/api.test.ts:1811-1937`, `packages/core/src/api.test.ts:2038` (the two `HTTP_RATE_LIMIT_DRIVER: "valkey"` blocks)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed by later tasks.

**Root cause (verified):** both tests set `HTTP_RATE_LIMIT_DRIVER: "valkey"` in `readEnv({...})`. `VALKEY_URL` defaults to `redis://localhost:6379` (`packages/config/src/index.ts:200`). Nothing listens there in CI or on a dev laptop, so `ValkeyRateLimiter.increment` throws `ApiError("rate_limit_unavailable", ..., 503)` at `packages/core/src/http/rate-limit.ts:264`, and the request 503s before ever reaching the edge-security handler.

**Why change the test and not the code:** the 503 is *correct* production behaviour — if the rate limiter is down, failing closed is right, and that fail-closed path deserves its own test. What's wrong is that these two tests declare a dependency on a live Valkey in order to assert something unrelated to Valkey (that security headers are applied). The driver setting is incidental to their purpose.

- [ ] **Step 1: Confirm the diagnosis**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
echo "--- is anything on 6379? ---"
lsof -ti:6379 >/dev/null 2>&1 && echo "valkey UP (diagnosis will not reproduce)" || echo "nothing on 6379 - expected"
echo "--- how many tests pin the valkey driver? ---"
grep -c 'HTTP_RATE_LIMIT_DRIVER: "valkey"' packages/core/src/api.test.ts
```

Expected: `nothing on 6379 - expected`, and the count is `2` — exactly the number of failing tests.

- [ ] **Step 2: Run the failing test to see the 503**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/api.test.ts -t "reports sanitized edge security posture and applies security headers"
```

Expected: FAIL — `AssertionError: expected 503 to be 200` at `src/api.test.ts:1937`

- [ ] **Step 3: Make both tests hermetic**

In `packages/core/src/api.test.ts`, in **both** blocks (near line 1926 and near line 2038), change:

```ts
        HTTP_RATE_LIMIT_DRIVER: "valkey",
```

to:

```ts
        // These tests assert security headers and edge enforcement codes, not
        // rate limiting. The valkey driver made them depend on a live server on
        // localhost:6379 and 503 in CI. The fail-closed valkey path has its own
        // test below ("fails closed when the valkey rate limiter is unavailable").
        HTTP_RATE_LIMIT_DRIVER: "memory",
```

Confirm both are changed:

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
grep -c 'HTTP_RATE_LIMIT_DRIVER: "valkey"' packages/core/src/api.test.ts
```

Expected: `0`

> If `"memory"` is not an accepted value, read the enum at `packages/config/src/index.ts` — search for `HTTP_RATE_LIMIT_DRIVER` — and use the in-process driver name it declares. Do not invent one.

- [ ] **Step 4: Run both tests and make sure they pass**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/api.test.ts -t "reports sanitized edge security posture and applies security headers"
pnpm exec vitest run src/api.test.ts -t "reports GA-aligned edge enforcement failure codes"
```

Expected: both `Tests 1 passed`

- [ ] **Step 5: Add the test that the old ones were accidentally providing**

The valkey fail-closed behaviour was only ever covered as a side effect. Cover it deliberately. Append this inside the same `describe` block in `packages/core/src/api.test.ts`:

```ts
  it("fails closed with 503 when the valkey rate limiter is unavailable", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        HTTP_RATE_LIMIT_DRIVER: "valkey",
        // Port 1 is reserved and never listening: guarantees connection refusal
        // without depending on whether a real valkey happens to run locally.
        VALKEY_URL: "redis://127.0.0.1:1",
      }),
    });

    const response = await api.request("/api/v1/health");

    expect(response.status).toBe(503);
    const body = (await response.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("rate_limit_unavailable");
  });
```

- [ ] **Step 6: Run it**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/api.test.ts -t "fails closed with 503 when the valkey rate limiter is unavailable"
```

Expected: `Tests 1 passed`

> If this fails because `/api/v1/health` is exempt from rate limiting, pick any authenticated route that is not exempt — check which routes the limiter middleware is mounted on in `packages/core/src/api.ts` — and assert against that instead. Do not assert a 503 on a route the limiter never runs for.

- [ ] **Step 7: Run the whole core suite**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run 2>&1 | tail -6
```

Expected: `Test Files 42 passed (42)`, `Tests 0 failed`

- [ ] **Step 8: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add packages/core/src/api.test.ts
git commit -m "$(cat <<'EOF'
fix(test): remove live-valkey dependency from edge security tests

Both tests set HTTP_RATE_LIMIT_DRIVER=valkey while asserting security
headers, so they 503'd whenever nothing listened on localhost:6379. The
driver was incidental to what they test; switch them to the in-process
driver.

Adds an explicit test for the valkey fail-closed 503 path, which these
tests were only covering by accident.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- Both edge-security tests pass with nothing listening on 6379.
- `grep -c 'HTTP_RATE_LIMIT_DRIVER: "valkey"' packages/core/src/api.test.ts` returns `1` — the new deliberate fail-closed test.
- `packages/core/src/http/rate-limit.ts` is **unmodified**.

---

### Task 1.3: Guard against fixture rot returning

**Files:**
- Modify: `packages/core/src/test-support/fixture-clock.test.ts`
- Modify: `packages/core/src/api.test.ts:16565`, `:16671`
- Modify: `packages/core/src/data-connectors.test.ts:971`, `:1116`
- Modify: `packages/core/src/jobs.test.ts:34`, `:72`

**Interfaces:**
- Consumes: `fixtureFuture`/`fixturePast` from Task 1.1.
- Produces: nothing.

**Why:** 705 hardcoded mid-2026 date literals remain across the suite. Most are inert payload data; the dangerous ones are those fed into expiry comparisons. A guard that fails loudly the moment a session fixture sits in the past converts a silent future breakage into an immediate, legible one.

**Why scoped to `expiresAt`, not all 705 dates:** rot only bites where a date is *compared against now*. A `createdAt` or `generatedAt` is never compared to `Date.now()`, so it cannot rot. `expiresAt` is the field that can.

**The design problem, and why the guard needs an opt-out.** A naive "no past-dated `expiresAt`" rule does not work. Scanning `packages/core` finds **8** past-dated `expiresAt` fixtures, and **6 of them are deliberate**:

| Site | Value | Verdict |
|---|---|---|
| `transaction-boundaries.test.ts:3106` | `2026-07-08` | **Rot** — fixed in Task 1.1 |
| `transaction-boundaries.test.ts:4572` | `2026-07-08` | **Rot** — fixed in Task 1.1 |
| `api.test.ts:16671` | `2020-01-01` | Deliberate — `workerId: "svc_expired_worker"` |
| `api.test.ts:16565` | `2026-06-30` | Deliberate — expired worker lease |
| `jobs.test.ts:34` | `2026-06-30` | Deliberate — `job_claimable`, lease must be expired to be reclaimed |
| `jobs.test.ts:72` | `2026-06-30` | Deliberate — same |
| `data-connectors.test.ts:971` | `2026-07-01` | Deliberate — `accessToken: "expired-github-token"` |
| `data-connectors.test.ts:1116` | `2026-07-01` | Deliberate — same |

Intent cannot be inferred from the value: a deliberately-expired lease and a rotted live session look identical to a regex. So the guard requires deliberate ones to **say so**. That is six one-line annotations, and they document intent that is currently implicit — `expiresAt: "2020-01-01T00:05:00.000Z"` does not currently tell a reader it is expired *on purpose*.

- [ ] **Step 1: Annotate the six deliberate fixtures**

Add the marker comment `// deliberately-expired:` with a reason to the **same line** as each of the six `expiresAt` values listed above. For example, at `packages/core/src/jobs.test.ts:34`:

```ts
          expiresAt: "2026-06-30T00:06:00.000Z", // deliberately-expired: lease must be stale for job_claimable to be reclaimed
```

At `packages/core/src/api.test.ts:16671`:

```ts
          expiresAt: "2020-01-01T00:05:00.000Z", // deliberately-expired: svc_expired_worker lease reclaim path
```

At `packages/core/src/data-connectors.test.ts:971`:

```ts
        expiresAt: "2026-07-01T00:00:01.000Z", // deliberately-expired: exercises the GitHub token refresh path
```

Apply the same treatment to `api.test.ts:16565`, `jobs.test.ts:72`, and `data-connectors.test.ts:1116`, each with the reason that fits its fixture. Read the surrounding fixture before writing the reason — do not paste the same text into all six.

- [ ] **Step 2: Write the guard**

Append to `packages/core/src/test-support/fixture-clock.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(import.meta.dirname, "..");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("fixture rot guard", () => {
  // A hardcoded future expiresAt is a time bomb: it passes until the date
  // arrives, then silently flips behaviour in any code that filters on expiry.
  // seedLocalSession's 2026-07-08 rotted a week after it was written and made
  // SessionService.revokeOthers look broken when it was fine.
  //
  // Deliberately-expired fixtures are legitimate and common (stale worker
  // leases, expired OAuth tokens). Intent is not inferable from the value, so
  // they must be marked. Everything else uses fixtureFuture()/fixturePast().
  it("has no unmarked expiresAt fixture pinned to a past literal date", () => {
    const offenders: string[] = [];

    for (const file of testFiles(SRC_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const match = /expiresAt:\s*"(\d{4}-\d{2}-\d{2}T[^"]+)"/.exec(line);
        if (match === null) return;
        // This repo compiles with noUncheckedIndexedAccess, so match[1] is
        // `string | undefined`. Bind and narrow it — `new Date(match[1])`
        // does not typecheck, and vitest will not catch that (it does not
        // typecheck); only `pnpm check` will.
        const iso = match[1];
        if (iso === undefined) return;
        if (new Date(iso).getTime() > Date.now()) return;
        if (line.includes("deliberately-expired:")) return;
        offenders.push(`${file}:${index + 1} -> ${iso}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it — it must pass now that Task 1.1 and Step 1 are done**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run src/test-support/fixture-clock.test.ts
```

Expected: `Tests 4 passed (4)`

If it reports offenders, each one is either a fixture Task 1.1 missed (fix it with `fixtureFuture()`) or a deliberate one Step 1 missed (annotate it). Do not widen the regex or delete the assertion to make it pass.

- [ ] **Step 4: Prove the guard actually catches rot**

A guard that never fires is decoration. Verify it fails on a real offender before trusting it.

> **Do not use `sed -i '' '0,/re/s//repl/'` here.** The `0,/re/` address is a GNU extension; BSD `sed` (macOS) **exits 0 and silently changes nothing**. A plant that never happened makes the guard "pass", which reads as a successful verification when in fact nothing was tested. Use the portable `perl` form below, and assert the plant landed before trusting the result.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
cp src/transaction-boundaries.test.ts /tmp/rot-guard-check.bak
# Replace only the FIRST fixtureFuture() occurrence. Portable across BSD/GNU.
perl -i -pe 'if (!$d && s/expiresAt: fixtureFuture\(\)/expiresAt: "2020-01-01T00:00:00.000Z"/) { $d = 1 }' src/transaction-boundaries.test.ts
# Prove the plant actually landed before drawing any conclusion from the guard.
grep -q '2020-01-01T00:00:00.000Z' src/transaction-boundaries.test.ts \
  && echo "PLANT OK" \
  || { echo "PLANT FAILED — the guard result below is meaningless"; }
pnpm exec vitest run src/test-support/fixture-clock.test.ts 2>&1 | grep -E "passed|failed|2020-01-01"
echo "--- restoring ---"
cp /tmp/rot-guard-check.bak src/transaction-boundaries.test.ts
rm /tmp/rot-guard-check.bak
```

Expected: `PLANT OK`, then the run **fails** and names `transaction-boundaries.test.ts:<line> -> 2020-01-01T00:00:00.000Z`. If you see `PLANT FAILED`, fix the plant before believing anything about the guard.

- [ ] **Step 5: Prove the opt-out works**

The marker must actually suppress a finding, or Step 1's six annotations are load-bearing but unverified.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
cp src/transaction-boundaries.test.ts /tmp/rot-guard-check2.bak
perl -i -pe 'if (!$d && s{expiresAt: fixtureFuture\(\)}{expiresAt: "2020-01-01T00:00:00.000Z", // deliberately-expired: guard opt-out check}) { $d = 1 }' src/transaction-boundaries.test.ts
grep -q 'guard opt-out check' src/transaction-boundaries.test.ts \
  && echo "PLANT OK" \
  || { echo "PLANT FAILED — the guard result below is meaningless"; }
pnpm exec vitest run src/test-support/fixture-clock.test.ts 2>&1 | grep -E "Tests.*passed|Tests.*failed"
echo "--- restoring ---"
cp /tmp/rot-guard-check2.bak src/transaction-boundaries.test.ts
rm /tmp/rot-guard-check2.bak
```

Expected: `PLANT OK`, then the run **passes** — the same past date that failed Step 4 is suppressed by the marker. Together, Steps 4 and 5 prove the guard discriminates rather than merely always-passing or always-failing.

- [ ] **Step 6: Confirm the restore and re-run**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
git diff --stat src/transaction-boundaries.test.ts
pnpm exec vitest run src/test-support/fixture-clock.test.ts
```

Expected: `git diff --stat` prints nothing (file restored); tests `4 passed`.

- [ ] **Step 7: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add packages/core/src/test-support/fixture-clock.test.ts \
        packages/core/src/api.test.ts \
        packages/core/src/data-connectors.test.ts \
        packages/core/src/jobs.test.ts
git commit -m "$(cat <<'EOF'
test: fail loudly when an expiresAt fixture rots into the past

Scans every *.test.ts for expiresAt pinned to a past literal date. A
deliberately-expired fixture (stale worker lease, expired OAuth token) is
legitimate and indistinguishable from rot by value alone, so those are
marked with `// deliberately-expired: <reason>` - six existing sites, whose
intent was previously implicit.

Verified both directions: the guard fires on a planted 2020 date, and the
marker suppresses it.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- The guard passes on the current tree.
- The guard **demonstrably fails** on a planted past date (Step 4) and **demonstrably passes** when that date is marked (Step 5). Both verified, neither assumed.
- All six deliberate fixtures carry a marker with a reason specific to that fixture.
- `git diff` shows no leftover planted offenders.

---

### Task 1.4: Establish the green baseline

**Files:** none modified. This task is a gate.

**Interfaces:**
- Consumes: Tasks 1.1–1.3.
- Produces: the verified-green baseline that makes Phase 2's deletion attributable.

- [ ] **Step 1: Run the full verification**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm verify 2>&1 | tail -25
```

Expected: exits 0. No `FAIL` lines. `packages/core` reports `0 failed`.

- [ ] **Step 2: Record the baseline numbers**

These are the numbers Phase 2 will be measured against. Capture them literally — do not estimate.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
echo "--- repo LOC baseline ---"
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.output/*' \
  | xargs wc -l | tail -1
echo "--- core test count baseline ---"
cd packages/core && pnpm exec vitest run 2>&1 | grep -E "^\s+Tests|^\s+Test Files"
```

Expected at time of writing: `334040 total` (this will be slightly higher after Phase 1 adds the fixture-clock files); core `Tests 548 passed` (545 original + 3 from Task 1.1, plus 1 from Task 1.2 and 1 from Task 1.3 = 550). Record the **actual** output — it is the comparison point for Task 2.5.

- [ ] **Step 3: Tag the baseline**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git tag green-baseline
git log --oneline | head -4
```

Expected: tag created; four commits listed.

**Phase 1 Definition of Done:**
- `pnpm verify` exits 0.
- Zero tests deleted, skipped, or weakened.
- `green-baseline` tag exists.
- Baseline LOC and test counts are recorded above.

---

# Phase 2 — Delete the posture apparatus

**Why:** ~18K lines that read JSON files no deployment creates, to grade the repo against its own CI output, behind 17 endpoints nobody calls, verified by tests that assert fixtures against themselves. It is the single largest source of drag in the codebase and it has no user.

**Why it's safe:** dependency analysis shows every service in the delete set is referenced *only* by the barrel `packages/core/src/services/index.ts`. The two with real consumers are explicitly kept.

**What is kept and why:**

| Service | Kept because |
|---|---|
| `ga-evidence-posture-service.ts` | `readiness-service.ts:32-34` imports it for the `ga_evidence` readiness check **and** the admin UI renders it via `posture-client.ts:12`. Real consumers. |
| `postgres-operational-posture-service.ts` | Admin UI renders it via `posture-client.ts:19`. Real consumer. |

**Expected recovery** (measured, not estimated):

| Delete set | LOC |
|---|---|
| `services/*posture*.ts` minus the 2 survivors | 14,167 |
| `http/routes/*posture*.ts` minus the 2 survivors | 217 |
| `http/openapi/*posture*.ts` minus the 2 survivors | 3,428 |
| **Direct subtotal** | **17,812** |
| Posture blocks in `api.test.ts` + 3 dedicated test files | ~6,700 |
| **Total** | **~24,500** |

Against a 334,040-line baseline that is **~7.3% of the repository**.

**Phase Definition of Done:**
- `pnpm verify` exits 0.
- The 2 surviving posture endpoints still return 200 and still render in the admin UI.
- `GET /api/v1/admin/network-partition/posture` (and the other 16) return 404.
- Repo LOC is at least 17,000 lower than the `green-baseline` tag.
- No `deploy/` or `.env.example` reference to a deleted env var remains.

---

### Task 2.1: Delete the unconsumed posture services and their routes

**Files:**
- Delete: 22 files matching `packages/core/src/services/*posture*.ts` (excluding `ga-evidence-posture-service.ts`, `postgres-operational-posture-service.ts`, and the 3 `kubernetes-posture-*.ts` helpers — see Step 2)
- Delete: 17 files matching `packages/core/src/http/routes/*posture*.ts` (excluding `ga-evidence-posture.ts`, `postgres-operational-posture.ts`)
- Delete: matching files in `packages/core/src/http/openapi/`
- Modify: `packages/core/src/services/index.ts`
- Modify: `packages/core/src/api.ts:16-73` (imports), `:104-136` (registrations)

**Interfaces:**
- Consumes: the `green-baseline` tag from Task 1.4.
- Produces: a `services/index.ts` barrel exporting only `GaEvidencePostureService` and `PostgresOperationalPostureService` from the posture family. `readiness-service.ts` continues to import `GaEvidencePostureService` from `./ga-evidence-posture-service` — that import path is unchanged.

- [ ] **Step 1: Verify the dependency claim before deleting anything**

Do not take the plan's word for it. Prove that nothing outside the posture family and the barrel imports the delete set.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
KEEP="ga-evidence-posture|postgres-operational-posture"
for f in packages/core/src/services/*posture*.ts; do
  base=$(basename "$f" .ts)
  echo "$base" | grep -qE "$KEEP" && continue
  hits=$(grep -rln "${base}" packages/core/src packages/api-client/src packages/cli/src apps/app/src sdks 2>/dev/null \
    | grep -v "posture" | grep -v "\.test\.ts")
  [ -n "$hits" ] && echo "!! UNEXPECTED CONSUMER: $base <- $hits"
done
echo "--- audit complete: any '!!' lines above are blockers ---"
```

Expected: **no `!!` lines.** Every hit should be `services/index.ts` only, which the grep already excludes by not matching. If a `!!` line appears, **stop and escalate** — the delete set is wrong.

- [ ] **Step 2: Build the exact delete list and review it by eye**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
KEEP="ga-evidence-posture|postgres-operational-posture"
find packages/core/src/services packages/core/src/http/routes packages/core/src/http/openapi \
  -name '*posture*' | grep -vE "$KEEP" | sort > /tmp/posture-delete-list.txt
wc -l /tmp/posture-delete-list.txt
cat /tmp/posture-delete-list.txt
xargs wc -l < /tmp/posture-delete-list.txt | tail -1
```

Expected: roughly 55-60 files, ~17,800 total lines.

**Read the list.** Three files need a judgement call: `kubernetes-posture-definitions.ts`, `kubernetes-posture-service.ts`, `kubernetes-posture-validation.ts` are a trio — they go together. Confirm none of them is imported by a keeper:

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
grep -n "kubernetes-posture" packages/core/src/services/ga-evidence-posture-service.ts \
                             packages/core/src/services/postgres-operational-posture-service.ts \
                             packages/core/src/services/readiness-service.ts || echo "SAFE TO DELETE ALL THREE"
```

Expected: `SAFE TO DELETE ALL THREE`

- [ ] **Step 3: Delete the files**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
xargs git rm < /tmp/posture-delete-list.txt
```

- [ ] **Step 4: Let the compiler find every dangling reference**

This is why Phase 0 and Phase 1 came first — the type checker is now the tool that finds the rest of the work, and a green baseline means every error it prints is caused by this deletion.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec tsc -p tsconfig.json --noEmit 2>&1 | head -40
```

Expected: a wall of `TS2307: Cannot find module './http/routes/...-posture'` errors originating from `src/api.ts` and `src/services/index.ts`. This is the to-do list for Steps 5 and 6.

- [ ] **Step 5: Prune the barrel**

In `packages/core/src/services/index.ts`, delete every `export * from "./…-posture-service"` / `export { … } from "./…-posture-service"` line whose target no longer exists. Keep exactly these two:

```ts
export * from "./ga-evidence-posture-service";
export * from "./postgres-operational-posture-service";
```

Find the lines to remove:

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
grep -n "posture" packages/core/src/services/index.ts
```

Delete every line naming a deleted module. Leave the two keepers.

- [ ] **Step 6: Prune the route registrations**

In `packages/core/src/api.ts`, delete every `import { register…PostureRoutes } from "./http/routes/…-posture";` and its matching `register…PostureRoutes(app);` call, for all deleted routes. Keep exactly these two pairs:

```ts
import { registerGaEvidencePostureRoutes } from "./http/routes/ga-evidence-posture";
import { registerPostgresOperationalPostureRoutes } from "./http/routes/postgres-operational-posture";
```

```ts
  registerGaEvidencePostureRoutes(app);
  registerPostgresOperationalPostureRoutes(app);
```

Find every line to touch:

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
grep -n "osture" packages/core/src/api.ts
```

Remove all except the four lines above.

- [ ] **Step 7: Type-check until clean**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec tsc -p tsconfig.json --noEmit
```

Expected: **no output** (clean). Repeat Steps 5-6 for any remaining error. Do not suppress an error with `@ts-ignore` — if something still references a deleted module, either the reference is dead (delete it) or the delete set was wrong (escalate).

- [ ] **Step 8: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add -A
git commit -m "$(cat <<'EOF'
refactor: delete 22 unconsumed posture services and their routes

Each posture service read an env-var file path, JSON.parsed it, checked a
schemaVersion, and echoed the fields back with a status verdict. None
queried a real system - kubernetes-posture-service imported only
node:fs/promises and never contacted a cluster. Every evidence path ships
as "" in .env.example, compose, and Helm, so the "ready" verdict was
unreachable in every committed configuration. 17 of 19 endpoints had no
caller.

Keeps ga-evidence (used by readiness-service and the admin UI) and
postgres-operational (used by the admin UI).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- `pnpm exec tsc --noEmit` in `packages/core` is clean.
- Step 1's consumer audit printed no `!!` lines.
- `services/index.ts` exports exactly the two surviving posture services.
- No `@ts-ignore` was added.

---

### Task 2.2: Delete the tautological posture tests

**Files:**
- Delete: `packages/core/src/audit-integrity-posture.test.ts`, `packages/core/src/enterprise-live-posture-strictness.test.ts`, `packages/core/src/target-resilience-posture-strictness.test.ts`
- Modify: `packages/core/src/api.test.ts` (remove posture `it(...)` blocks for deleted endpoints)

**Interfaces:**
- Consumes: Task 2.1.
- Produces: nothing.

**Why these tests are worthless, stated precisely:** the pattern at `api.test.ts:5858-5997` writes the evidence JSON fixture, points the env var at it, calls the endpoint, then asserts the response contains what it just wrote. Fixture written at `:5880-5883` (`partitionInjected: true, partitionedDependencyCount: 2, …`); assertion at `:5956-5960` asserts exactly those values. That is `JSON.parse(JSON.stringify(x)) === x`. It cannot catch a defect because there is no behaviour between input and output.

- [ ] **Step 1: Confirm the suite is red in exactly the expected way**

After Task 2.1 the tests for deleted endpoints must now fail — they reference deleted modules.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec vitest run 2>&1 | grep -E "Cannot find module|Test Files" | head -10
```

Expected: import errors naming deleted posture modules. This confirms which test files to remove.

- [ ] **Step 2: Delete the three dedicated posture test files**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git rm packages/core/src/audit-integrity-posture.test.ts \
       packages/core/src/enterprise-live-posture-strictness.test.ts \
       packages/core/src/target-resilience-posture-strictness.test.ts
```

- [ ] **Step 3: Remove the posture blocks from api.test.ts**

Find them:

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
grep -n "  it(\".*posture\|  it(\".*evidence" packages/core/src/api.test.ts
```

Delete each `it("…")` block whose endpoint was removed in Task 2.1 — the whole block from `it(` to its closing `});`.

**Keep** every block that tests:
- `ga-evidence` or `postgres/operational` posture (the survivors),
- the two edge-security tests fixed in Task 1.2 (they assert real middleware behaviour, not echo),
- the valkey fail-closed test added in Task 1.2.

- [ ] **Step 4: Type-check and run**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/packages/core
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec vitest run 2>&1 | tail -6
```

Expected: `tsc` clean; `Tests 0 failed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add -A
git commit -m "$(cat <<'EOF'
test: delete tautological posture tests

These tests wrote an evidence fixture, pointed an env var at it, called the
endpoint, then asserted the response matched what they had just written -
verifying that JSON.parse works. They exercised no behaviour and could not
fail for any real defect.

Keeps the edge-security tests, which assert real middleware behaviour.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- `pnpm exec vitest run` in `packages/core` passes with 0 failures.
- The edge-security and valkey fail-closed tests from Phase 1 still exist and still pass.

---

### Task 2.3: Remove the dead evidence configuration

**Files:**
- Modify: `packages/config/src/index.ts:20-79`
- Modify: `.env.example`, `deploy/compose/.env.example`, `deploy/compose/compose.yml:27-58`, `deploy/helm/values.yaml:168-180`

**Interfaces:**
- Consumes: Task 2.1.
- Produces: a `RomeoEnv` type without the deleted evidence-path keys. Anything still reading one will fail type-check — which is the point.

**Why this is a separate task from 2.1:** deleting the services leaves the env vars orphaned but harmless, so 2.1 stays a clean, revertable, code-only change. Config and deployment manifests are a different blast radius (they touch Helm and Compose) and deserve their own commit and their own revert.

- [ ] **Step 1: Find the orphans**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
for v in $(grep -oE "[A-Z_]+_EVIDENCE_PATH" packages/config/src/index.ts | sort -u); do
  used=$(grep -rl "$v" packages/core/src packages/cli/src apps/app/src 2>/dev/null | head -1)
  [ -z "$used" ] && echo "ORPHAN: $v"
done
```

Expected: a list of evidence-path vars no longer read by any surviving code.

- [ ] **Step 2: Remove each orphan from the config schema**

In `packages/config/src/index.ts`, delete the `z.string().default("")` line for every var Step 1 listed as `ORPHAN`. Keep any var still referenced by the two surviving posture services (`GA_CHECKLIST_PATH`, `GA_TARGET_PREFLIGHT_PATH`, `GA_TARGET_PLAN_PATH`, `GA_TARGET_EXECUTION_PATH`, `GA_EVIDENCE_BUNDLE_PATH` and the Postgres operational equivalents — Step 1 will not list these as orphans).

- [ ] **Step 3: Remove them from deployment manifests**

For each orphan var, remove its line from:
- `.env.example`
- `deploy/compose/.env.example`
- `deploy/compose/compose.yml` (the `${VAR:-}` passthroughs, lines ~27-58)
- `deploy/helm/values.yaml` (the `VAR: ""` entries, lines ~168-180)

Verify none survive:

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
for v in $(grep -oE "[A-Z_]+_EVIDENCE_PATH" .env.example deploy/compose/compose.yml deploy/helm/values.yaml 2>/dev/null | cut -d: -f2 | sort -u); do
  grep -q "$v" packages/config/src/index.ts || echo "STILL REFERENCED IN DEPLOY BUT GONE FROM CONFIG: $v"
done
echo "--- done ---"
```

Expected: no `STILL REFERENCED` lines.

- [ ] **Step 4: Type-check the workspace**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm -r --sort check 2>&1 | tail -12
```

Expected: clean. Any error names a file still reading a deleted env var — remove that read; do not re-add the var.

- [ ] **Step 5: Validate the Helm chart still renders**

Config changes that type-check can still break deployment. Check it.

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
command -v helm >/dev/null 2>&1 && helm template deploy/helm >/dev/null && echo "HELM RENDERS OK" || echo "helm not installed - SKIPPED (note in PR)"
```

Expected: `HELM RENDERS OK`, or an explicit skip note. If helm is installed and this fails, fix the chart before committing.

- [ ] **Step 6: Validate the Compose file still parses**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
command -v docker >/dev/null 2>&1 && docker compose -f deploy/compose/compose.yml config >/dev/null && echo "COMPOSE OK" || echo "docker not available - SKIPPED (note in PR)"
```

Expected: `COMPOSE OK`, or an explicit skip note.

- [ ] **Step 7: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add -A
git commit -m "$(cat <<'EOF'
chore: remove evidence-path env vars for deleted posture services

Every one shipped as "" in .env.example, compose, and Helm - they were
never configured in any deployment, which is why the posture services they
fed could never return a ready verdict.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- `pnpm -r --sort check` is clean.
- No orphaned `*_EVIDENCE_PATH` remains in config or deployment manifests.
- Helm renders and Compose parses (or the skip is explicitly noted).

---

### Task 2.4: Prune the dead npm scripts

**Files:**
- Modify: `package.json`
- Delete: files under `scripts/` that only served deleted endpoints

**Interfaces:**
- Consumes: Tasks 2.1-2.3.
- Produces: nothing.

**Context:** there are **124 npm scripts**, 57 of them `smoke:*`, and 88 of 118 files in `scripts/` are GA/posture/evidence-related. Many generated evidence for endpoints that no longer exist. **Be conservative here:** the GA checklist generator still feeds `ga-evidence-posture-service`, which readiness uses. Only remove scripts whose sole consumer was deleted.

- [ ] **Step 1: Find scripts referencing deleted modules**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
for f in scripts/*.mjs; do
  refs=$(grep -loE "network-partition|migration-drill|secret-rotation-drill|provider-outage|tool-dispatch-posture|voice-provider-live|notification-adapter-live|identity-live|analytics-authz|audit-integrity|billing-operations|ci-governance|alert-firing|support-bundle|tenant-purge-evidence|target-quality|release-readback|release-security-posture|kubernetes-posture|rag-posture" "$f" 2>/dev/null)
  [ -n "$refs" ] && echo "$f"
done
```

- [ ] **Step 2: For each candidate, confirm nothing else needs it**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
# Replace <script> with each candidate basename from Step 1
grep -n "<script>" package.json .github/workflows/*.yml 2>/dev/null
```

A script referenced only by its own `package.json` entry, and by no workflow and no other script, is safe to delete. **If a script is referenced by `generate-ga-checklist.mjs` or by the GA evidence chain, keep it** — `ga-evidence-posture-service` survives and readiness depends on it.

- [ ] **Step 3: Delete the confirmed-dead scripts and their package.json entries**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git rm scripts/<confirmed-dead-script>.mjs   # repeat per confirmed file
```

Remove each corresponding line from the `"scripts"` block in `package.json`.

- [ ] **Step 4: Verify no package.json script points at a deleted file**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
node -e '
const p = require("./package.json");
const { existsSync } = require("fs");
let broken = 0;
for (const [name, cmd] of Object.entries(p.scripts)) {
  const m = /scripts\/([\w.-]+\.mjs)/.exec(cmd);
  if (m && !existsSync("scripts/" + m[1])) { console.log("BROKEN:", name, "->", m[1]); broken++; }
}
console.log(broken === 0 ? "ALL SCRIPT TARGETS EXIST" : `${broken} BROKEN`);
'
```

Expected: `ALL SCRIPT TARGETS EXIST`

- [ ] **Step 5: Verify CI workflows don't call a deleted script**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
for s in $(git diff --cached --name-only --diff-filter=D | grep '^scripts/' | xargs -n1 basename 2>/dev/null); do
  grep -rn "$s" .github/workflows/ 2>/dev/null && echo "!! CI STILL CALLS $s"
done
echo "--- audit complete ---"
```

Expected: no `!!` lines.

- [ ] **Step 6: Run verify**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm verify 2>&1 | tail -8
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add -A
git commit -m "$(cat <<'EOF'
chore: remove smoke scripts for deleted posture endpoints

Kept the GA checklist chain, which still feeds ga-evidence-posture-service
and the readiness check.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- Every `package.json` script points at a file that exists.
- No CI workflow calls a deleted script.
- `pnpm verify` exits 0.

---

### Task 2.5: Verify the deletion end-to-end

**Files:** none modified. This task is a gate.

**Interfaces:**
- Consumes: Tasks 2.1-2.4.
- Produces: evidence that the survivors work and the deleted endpoints are gone.

**Why a live check and not just a green suite:** the tests that covered these endpoints were deleted along with them. Only driving the running app proves the two survivors still work and the other 17 are actually gone.

- [ ] **Step 1: Full verification**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm verify 2>&1 | tail -10
```

Expected: exits 0.

- [ ] **Step 2: Measure the actual recovery**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
echo "--- LOC now ---"
find . -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.mjs' \) \
  -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.output/*' \
  | xargs wc -l | tail -1
echo "--- vs baseline (334040) ---"
git diff --stat green-baseline HEAD | tail -1
```

Expected: at least 17,000 lines removed net.

- [ ] **Step 3: Boot the app**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm dev > /tmp/romeo-dev.log 2>&1 &
sleep 15
curl -s -m 5 http://localhost:3000/api/v1/health
```

Expected: `{"data":{"status":"ok","service":"romeo-api","version":"0.1.0",...}}`

- [ ] **Step 4: Confirm the survivors still respond**

```bash
curl -s -o /dev/null -w "ga-evidence:        %{http_code}\n" http://localhost:3000/api/v1/admin/ga/evidence-posture
curl -s -o /dev/null -w "postgres-operational: %{http_code}\n" http://localhost:3000/api/v1/admin/postgres/operational-posture
```

Expected: both `200`.

- [ ] **Step 5: Confirm the deleted endpoints are gone**

```bash
for p in network-partition/posture migration-drill/posture kubernetes/posture \
         provider-outage/posture support-bundle/posture voice-provider-live/posture; do
  curl -s -o /dev/null -w "$p: %{http_code}\n" "http://localhost:3000/api/v1/admin/$p"
done
```

Expected: all `404`.

- [ ] **Step 6: Confirm the admin posture tab still renders**

Open `http://localhost:3000/admin?section=posture` in a browser. The Operations Posture panel must render GA evidence and Postgres operational data without a console error.

Then check the readiness card on `http://localhost:3000/admin` — the `ga_evidence` check must still appear (it will report as not-configured, which is correct and expected: `GA_CHECKLIST_PATH` defaults to `""`).

- [ ] **Step 7: Stop the server**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null; echo "stopped"
```

- [ ] **Step 8: Tag**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git tag posture-removed
```

**Phase 2 Definition of Done:**
- `pnpm verify` exits 0.
- ≥17,000 net lines removed vs `green-baseline`.
- Both surviving posture endpoints return 200; ≥6 sampled deleted endpoints return 404.
- Admin posture tab renders; `ga_evidence` readiness check still present.
- `posture-removed` tag exists.

---

# Phase 3 — Chat UX table stakes

**Why now:** with the drag removed, this is where effort converts into product. Every task here is small because the backend already exists — `updateChat` and `archiveChat` are already in `apps/app/src/api/chat-client.ts:65-99` with routes behind them. This phase is almost entirely UI wiring.

**Why these four:** they are the gaps a user hits within sixty seconds of real use. Autoscroll is the most severe — without it, streaming output runs off the bottom of the viewport and the user must scroll manually while the model is talking.

**Phase Definition of Done:**
- Streaming output stays visible without manual scrolling, and does **not** yank a user who has scrolled up.
- The composer grows with multi-line input up to its existing 384px max.
- A chat can be renamed and deleted from the sidebar.
- The last assistant response can be regenerated.
- `pnpm verify` exits 0.

---

### Task 3.1: Keep streaming output visible

**Files:**
- Create: `apps/app/src/lib/use-stick-to-bottom.ts`
- Modify: `apps/app/src/components/ChatPanel.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `useStickToBottom(dep: unknown): React.RefObject<HTMLDivElement>` — attach the returned ref to the scroll container. Task 3.4 does not depend on this.

**The problem:** there is no `scrollIntoView` or `scrollTop` anywhere in `ChatPanel.tsx` or `useWorkspaceController.ts`, and no `overflow-anchor` on `.rm-conversation` (`app.css:791`). Tokens stream in below the fold.

**Design decision — why not the one-liner:** `overflow-anchor: auto` is CSS-native and tempting, but it anchors to *existing* content to prevent jumps; it does not follow *appended* content. `flex-direction: column-reverse` sticks to the bottom natively but inverts DOM order and breaks text-selection order. Neither does the job. The honest minimum is ~15 lines that scroll on change *only when the user is already near the bottom* — the near-bottom check is the whole point, because a scroll-to-bottom that fires unconditionally rips the page away from someone reading history.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/use-stick-to-bottom.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { shouldStickToBottom } from "./use-stick-to-bottom";

describe("shouldStickToBottom", () => {
  it("sticks when the viewport is already at the bottom", () => {
    expect(
      shouldStickToBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }),
    ).toBe(true);
  });

  it("sticks when within the slack threshold of the bottom", () => {
    expect(
      shouldStickToBottom({ scrollTop: 880, clientHeight: 100, scrollHeight: 1000 }),
    ).toBe(true);
  });

  it("does NOT stick when the user has scrolled up to read history", () => {
    expect(
      shouldStickToBottom({ scrollTop: 200, clientHeight: 100, scrollHeight: 1000 }),
    ).toBe(false);
  });

  it("sticks when content is shorter than the viewport", () => {
    expect(
      shouldStickToBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 }),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/apps/app
pnpm exec vitest run src/lib/use-stick-to-bottom.test.ts
```

Expected: FAIL — `Failed to resolve import "./use-stick-to-bottom"`

- [ ] **Step 3: Write the minimal implementation**

Create `apps/app/src/lib/use-stick-to-bottom.ts`:

```ts
import { useEffect, useRef } from "react";

// Slack in px. A user within this distance of the bottom is "following" the
// stream and wants to keep following; beyond it they are reading history and
// must not be yanked away mid-sentence.
const STICK_THRESHOLD_PX = 64;

export function shouldStickToBottom(metrics: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  const distanceFromBottom =
    metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight;
  return distanceFromBottom <= STICK_THRESHOLD_PX;
}

// ponytail: no IntersectionObserver, no scroll library. CSS alone can't do this
// - overflow-anchor holds existing content in place but doesn't follow appended
// content, and column-reverse breaks selection order. This is the minimum that
// follows the stream without fighting a user who scrolled up.
export function useStickToBottom(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  // Record intent on every user scroll, before the next append changes metrics.
  useEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const onScroll = () => {
      stick.current = shouldStickToBottom(node);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (node === null || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [dep]);

  return ref;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo/apps/app
pnpm exec vitest run src/lib/use-stick-to-bottom.test.ts
```

Expected: `Tests 4 passed (4)`

- [ ] **Step 5: Wire it into ChatPanel**

In `apps/app/src/components/ChatPanel.tsx`, add the import:

```tsx
import { useStickToBottom } from "../lib/use-stick-to-bottom";
```

Inside the component body, add:

```tsx
  // Re-runs on every token: messages is a new array each delta, so the effect
  // fires throughout the stream, not just on message boundaries.
  const conversationRef = useStickToBottom(messages);
```

Attach the ref to the scroll container — the element carrying `className="rm-conversation"`:

```tsx
  <div className="rm-conversation" ref={conversationRef}>
```

`.rm-conversation` is confirmed to be the scroll container — `apps/app/src/styles/app.css:791-796` sets `overflow: auto` and `min-height: 0` on it. Attach the ref to that element, not to a parent.

- [ ] **Step 6: Verify in the real app — this cannot be verified by unit test**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm dev
```

Open `http://localhost:3000`, then check all three behaviours:

1. Send a prompt long enough to overflow the viewport ("write 400 words about postgres indexes"). **Expected:** the view follows the output; the newest tokens stay visible.
2. While it streams, scroll up. **Expected:** the view stays where you put it and does **not** jump back down.
3. Scroll back to the bottom while it streams. **Expected:** following resumes.

All three must hold. Behaviour 2 is the one that regresses if the near-bottom check is wrong.

- [ ] **Step 7: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add apps/app/src/lib/use-stick-to-bottom.ts \
        apps/app/src/lib/use-stick-to-bottom.test.ts \
        apps/app/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat(chat): follow streaming output without fighting the user

Streamed tokens ran off the bottom of the viewport with no autoscroll.
Follows the stream only when the user is within 64px of the bottom, so
scrolling up to read history is not interrupted.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- All 4 unit tests pass.
- All 3 manual behaviours in Step 6 verified in a browser against a real streaming response.
- Scrolling up during a stream is not interrupted.

---

### Task 3.2: Make the composer grow with its content

**Files:**
- Modify: `apps/app/src/components/ChatPanel.tsx:104`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

**The problem:** `app.css:1142-1146` sets `min-height: 38px; max-height: 384px`, and `ChatPanel.tsx:104` hardcodes `rows={1}`, but nothing adjusts height. The 384px max-height is dead code — a multi-line draft scrolls inside a 38px box.

**Design decision:** CSS `field-sizing: content` is the true one-liner and is exactly this feature, natively. It is not yet safe across all target browsers, and a composer that silently doesn't grow in Safari is worse than a few lines of JS that work everywhere. Ship the JS; the ponytail comment records the one-line replacement for when support lands.

- [ ] **Step 1: Add autogrow to the textarea**

In `apps/app/src/components/ChatPanel.tsx`, find the `<textarea>` at line ~104 and add an `onInput` handler alongside the existing props:

```tsx
        onInput={(event) => {
          // ponytail: replace this whole handler with `field-sizing: content` in
          // app.css once Safari/Firefox support is broad enough. Until then CSS
          // cannot measure content, so the height comes from scrollHeight.
          const el = event.currentTarget;
          el.style.height = "auto"; // reset first, or it can only ever grow
          el.style.height = `${el.scrollHeight}px`;
        }}
```

Leave `rows={1}` as-is — it is the correct collapsed height. The `max-height: 384px` in `app.css:1145` now does its job and takes over past ~16 lines.

- [ ] **Step 2: Reset the height after send**

The textarea keeps its grown height after the value is cleared. Find the submit handler in the same file and, immediately after the call that clears the draft value, add:

```tsx
    // The value is cleared but the inline height persists; reset it so the
    // composer collapses back to one row.
    if (textareaRef.current !== null) textareaRef.current.style.height = "auto";
```

If no `textareaRef` exists, add one:

```tsx
  const textareaRef = useRef<HTMLTextAreaElement>(null);
```

and put `ref={textareaRef}` on the `<textarea>`. Ensure `useRef` is imported from `react`.

- [ ] **Step 3: Verify in the browser — this is a layout behaviour, not a unit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm dev
```

At `http://localhost:3000`:

1. Type a single line. **Expected:** the composer stays one row tall.
2. Paste ~10 lines. **Expected:** it grows to fit, no inner scrollbar.
3. Paste ~40 lines. **Expected:** it stops at 384px and scrolls internally.
4. Send the message. **Expected:** it collapses back to one row.

- [ ] **Step 4: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add apps/app/src/components/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat(chat): grow the composer with its content

rows={1} was hardcoded with nothing adjusting height, so the 384px
max-height in app.css was dead code and multi-line drafts scrolled inside a
38px box. Resets height on send.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- All 4 browser behaviours in Step 3 verified.
- The existing 384px ceiling is respected (not raised, not removed).

---

### Task 3.3: Rename and delete chats from the sidebar

**Files:**
- Modify: `apps/app/src/components/WorkspaceNav.tsx:128-149`
- Modify: `apps/app/src/components/useWorkspaceController.ts`

**Interfaces:**
- Consumes: `updateChat(chatId, { title })` and `archiveChat(chatId)` from `apps/app/src/api/chat-client.ts:65-99` — **both already exist with backend routes.** No API work.
- Produces: `renameChat(chatId: string, title: string): Promise<void>` and `deleteChat(chatId: string): Promise<void>` on the controller returned by `useWorkspaceController`.

**The problem:** `WorkspaceNav.tsx:139-147` renders each chat as a bare `<button>` with a title and nothing else. A chat can be created but never renamed or removed — the sidebar accumulates "New chat" forever.

**Design decision:** delete maps to `archiveChat`, not a hard delete. Archive is what the API offers, it is reversible, and it respects the retention/legal-hold machinery already in the domain (`chats.legalHoldUntil`). A hard delete would fight that. **Reuse the existing `OverflowMenu`, `FormDialog`, and `ConfirmDialog` components** — do not build new ones.

- [ ] **Step 1: Add the mutations to the controller**

In `apps/app/src/components/useWorkspaceController.ts`, add to the imports from `../api/chat-client`:

```ts
import { archiveChat, updateChat } from "../api/chat-client";
```

(Merge into the existing import from that module rather than adding a second one.)

Add these handlers in the controller body, next to the existing chat handlers:

```ts
  const renameChat = useCallback(
    async (chatId: string, title: string): Promise<void> => {
      const trimmed = title.trim();
      if (trimmed.length === 0) return;
      await updateChat(chatId, { title: trimmed });
      await refreshChats();
    },
    [refreshChats],
  );

  const deleteChat = useCallback(
    async (chatId: string): Promise<void> => {
      // Archive, not hard-delete: it is what the API exposes, it is reversible,
      // and it respects the retention/legal-hold rules already in the domain.
      await archiveChat(chatId);
      if (chatId === activeChatId) startNewChat();
      await refreshChats();
    },
    [activeChatId, refreshChats, startNewChat],
  );
```

Add `renameChat` and `deleteChat` to the object the hook returns.

> Names must match what already exists in this file. If the chat-list refresh function is not called `refreshChats`, or the new-chat function is not called `startNewChat`, use the real names — read the file's return object first. Do not introduce a second refresh path.

- [ ] **Step 2: Thread them into WorkspaceNav's props**

In `apps/app/src/components/WorkspaceNav.tsx`, add to the props interface:

```tsx
  onRenameChat: (chatId: string, title: string) => void;
  onDeleteChat: (chatId: string) => void;
```

Pass them from `WorkspaceShell.tsx` where `<WorkspaceNav>` is rendered, wiring to the controller's `renameChat` / `deleteChat`.

- [ ] **Step 3: Render the affordances**

Replace the chat list body at `WorkspaceNav.tsx:139-147` with:

```tsx
            chats.map((chat) => (
              <div
                className={`rm-sidebar-item ${chat.id === activeChatId ? "active" : ""}`}
                key={chat.id}
              >
                <button
                  className="rm-sidebar-item-label truncate"
                  onClick={() => onSelectChat(chat.id)}
                  type="button"
                >
                  {chat.title}
                </button>
                <OverflowMenu
                  items={[
                    {
                      label: "Rename",
                      onSelect: () => setRenamingChat(chat),
                    },
                    {
                      label: "Delete",
                      onSelect: () => setDeletingChat(chat),
                    },
                  ]}
                  label={`Actions for ${chat.title}`}
                />
              </div>
            ))
```

Add the local state above the return:

```tsx
  const [renamingChat, setRenamingChat] = useState<Chat | null>(null);
  const [deletingChat, setDeletingChat] = useState<Chat | null>(null);
```

Render the two dialogs at the end of the component, reusing the existing components:

```tsx
      {renamingChat !== null && (
        <FormDialog
          title="Rename chat"
          initialValue={renamingChat.title}
          onCancel={() => setRenamingChat(null)}
          onSubmit={(title) => {
            onRenameChat(renamingChat.id, title);
            setRenamingChat(null);
          }}
        />
      )}
      {deletingChat !== null && (
        <ConfirmDialog
          title="Delete chat"
          message={`Delete "${deletingChat.title}"? You can restore it from archived chats.`}
          onCancel={() => setDeletingChat(null)}
          onConfirm={() => {
            onDeleteChat(deletingChat.id);
            setDeletingChat(null);
          }}
        />
      )}
```

> `OverflowMenu`, `FormDialog`, and `ConfirmDialog` already exist in `apps/app/src/components/`. **Read each one's actual props before wiring** — the prop names above are the intent, not a guarantee. Adapt to the real signatures; do not modify the shared components to match this snippet, and do not build replacements.

- [ ] **Step 4: Style the row**

The row is now a flex container with a label and a menu. In `apps/app/src/styles/app.css`, next to the existing `.rm-sidebar-item` rule, add:

```css
.rm-sidebar-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.rm-sidebar-item-label {
  flex: 1;
  min-width: 0; /* lets truncate actually truncate inside a flex child */
  text-align: left;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
```

> Merge these into the existing `.rm-sidebar-item` rule rather than duplicating the selector. Read the current rule first.

- [ ] **Step 5: Verify in the browser**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm dev
```

At `http://localhost:3000`:

1. Create two chats by sending a message in each.
2. Rename the first. **Expected:** the sidebar label updates; the change survives a page reload.
3. Delete the second while it is **not** active. **Expected:** it disappears from the list.
4. Delete the chat that **is** active. **Expected:** it disappears and the view resets to the new-chat empty state — no crash, no orphaned message list.
5. Confirm keyboard access: Tab to the menu, open with Enter, Escape closes it.

Case 4 is the one that breaks if `deleteChat` doesn't handle the active chat.

- [ ] **Step 6: Type-check and verify**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm verify 2>&1 | tail -6
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add apps/app/src/components/WorkspaceNav.tsx \
        apps/app/src/components/WorkspaceShell.tsx \
        apps/app/src/components/useWorkspaceController.ts \
        apps/app/src/styles/app.css
git commit -m "$(cat <<'EOF'
feat(chat): rename and delete chats from the sidebar

updateChat and archiveChat already existed in chat-client with routes
behind them; only the UI was missing. Delete maps to archive - reversible
and consistent with the retention/legal-hold rules already in the domain.

Reuses the existing OverflowMenu, FormDialog, and ConfirmDialog.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- Rename persists across a reload.
- Deleting a non-active chat removes it; deleting the active chat resets to the empty state without a crash.
- Menu is keyboard-navigable and Escape-dismissible.
- No new dialog/menu component was created.
- `pnpm verify` exits 0.

---

### Task 3.4: Regenerate the last assistant response

**Files:**
- Modify: `apps/app/src/components/useWorkspaceController.ts`
- Modify: `apps/app/src/components/ChatPanel.tsx:270-297` (the message action row)

**Interfaces:**
- Consumes: the existing `startRun` / `streamRunEvents` path in `useWorkspaceController.ts:101-173`.
- Produces: `regenerateLast(): Promise<void>` on the controller.

**The problem:** message actions are copy and read-aloud only (`ChatPanel.tsx:270-297`). Grep for `regenerate|editMessage|retry` across `apps/app/src` returns nothing. A bad response is a dead end — the user must retype the prompt.

**Scope decision:** regenerate only. **Message editing is deliberately excluded** — editing forks conversation history, which needs a branching model in the domain, a UI for navigating branches, and a persistence decision. That is a feature, not a gap, and it belongs in Phase 4. Regenerate needs none of that: it re-runs the last user message.

- [ ] **Step 1: Add regenerateLast to the controller**

In `apps/app/src/components/useWorkspaceController.ts`, add:

```ts
  const regenerateLast = useCallback(async (): Promise<void> => {
    if (isStreaming) return;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser === undefined) return;

    // Drop the trailing assistant turn so the re-run replaces it rather than
    // appending a second answer to the same prompt.
    const lastIsAssistant = messages.at(-1)?.role === "assistant";
    if (lastIsAssistant) setMessages((prev) => prev.slice(0, -1));

    await sendMessage(lastUser.content);
  }, [isStreaming, messages, sendMessage]);
```

Add `regenerateLast` to the hook's returned object.

> The names `isStreaming`, `messages`, `setMessages`, and `sendMessage` must match what this file already defines — read its return object and state declarations first. If the send function takes an attachments argument, pass the last user message's attachments too, or regenerating a message that had an image will silently drop it.

- [ ] **Step 2: Add the action to the message row**

In `apps/app/src/components/ChatPanel.tsx`, in the action row at ~270-297 (where copy and read-aloud live), add — rendered **only** for the last assistant message and **only** when not streaming:

```tsx
                {!isStreaming &&
                  message.role === "assistant" &&
                  index === messages.length - 1 && (
                    <button
                      aria-label="Regenerate response"
                      className="rm-message-action"
                      onClick={() => void onRegenerate()}
                      title="Regenerate response"
                      type="button"
                    >
                      <RefreshCw aria-hidden="true" size={14} />
                    </button>
                  )}
```

Add `RefreshCw` to the existing `lucide-react` import. Thread `onRegenerate` and `isStreaming` in as props from `WorkspaceShell.tsx`, matching how the existing message actions are wired.

- [ ] **Step 3: Verify in the browser**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm dev
```

At `http://localhost:3000`:

1. Send "name three colours" and wait for the response.
2. **Expected:** the regenerate button appears on the last assistant message only — not on earlier ones, not on user messages.
3. Click it. **Expected:** the old answer is replaced (not appended to) and a new one streams in.
4. **Expected:** the button is hidden while streaming.
5. Reload. **Expected:** the persisted history shows one user message and one assistant message — not a duplicate pair.

Case 5 is the one that catches a broken replace-vs-append.

- [ ] **Step 4: Verify**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm verify 2>&1 | tail -6
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
git add apps/app/src/components/useWorkspaceController.ts \
        apps/app/src/components/ChatPanel.tsx \
        apps/app/src/components/WorkspaceShell.tsx
git commit -m "$(cat <<'EOF'
feat(chat): regenerate the last assistant response

A bad response was a dead end - message actions were copy and read-aloud
only. Re-runs the last user message and replaces the trailing assistant
turn.

Message editing is deliberately out of scope: it forks history and needs a
branching model in the domain first.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

**Task Definition of Done:**
- Regenerate appears only on the last assistant message, only when idle.
- It replaces rather than appends — verified by reloading and confirming no duplicate pair persisted.
- `pnpm verify` exits 0.

---

# Phase 4 — Decisions required before more planning

These are **not tasks.** Each needs a business decision I cannot make from the code, and writing tasks for them now would produce exactly the speculative scaffolding this plan is removing in Phase 2. Each entry states the decision, the evidence, and the cost of the options.

### Decision 1: What is Romeo's relationship to Open WebUI?

**Evidence:** `openwebui-compatibility-service.ts` is **3,352 lines** — the largest file in the repo — implementing 20 Open WebUI endpoints (`/api/config`, `/api/v1/chats/*`, `/folders/`, `/channels/`, `/auths/`). It hardcodes `enable_image_generation: false`. The README says Open WebUI is "a product and UX reference only."

**The contradiction:** you don't write 3,352 lines of another product's wire protocol for a product that's only a UX reference. Either it is a migration path (drop-in replacement so OWUI clients can point at Romeo) or it is dead weight.

**Options:**
- **(a) It's a migration path.** Then it needs completion — the model/chat-completion endpoints are absent, so an OWUI frontend can list chats but cannot actually converse. Plus a compatibility test suite. Significant work.
- **(b) It's vestigial.** Delete 3,352 lines plus `routes/openwebui.ts` (680) and `openwebui-paths.ts` (1,183) — **~5,200 lines**, on top of Phase 2's ~24,500.

**This blocks:** any further work on that file. **Recommendation:** (b) unless a named customer is migrating from Open WebUI. Nothing in the codebase suggests one exists.

### Decision 2: Which consumer gaps actually matter?

Romeo is missing, versus Open WebUI: **image generation** (absent; OWUI has 4 backends), **web search** (absent; OWUI ships 29 providers), **i18n** (absent, no framework; OWUI has 63 locales), **code execution / artifacts** (absent), **notes** (absent), **pipelines/functions/valves** (absent — OWUI's whole extensibility story), **multi-model chat** (single-select only).

**These are not equal.** Web search is table stakes for a modern chat product and is a contained backend feature. i18n is the most expensive — retrofitting across ~90 components with all strings currently inline, plus `lang="en"` hardcoded at `__root.tsx:54`. Notes and artifacts are whole product surfaces.

**Needed:** a ranked list of which are required for the target customer. **My recommendation:** web search first — highest ratio of user-visible value to work, and it composes with the RAG layer that already exists.

### Decision 3: The model picker is misleading and should be fixed or renamed

**Evidence:** `ModelSelector.tsx:8-12` comments that "Agents are Romeo's equivalent of OWUI's custom models." It selects **agents**, not models. Actual model choice lives in admin under `AgentStudioPanel`. A user who wants to switch from GPT-4 to Llama cannot do it from the chat screen.

**Options:** (a) add a real model picker alongside the agent picker; (b) rename the control to "Assistant" so it stops implying something it isn't.

**Recommendation:** (b) now — it is a one-word change that removes a lie — and (a) only if users actually switch models per-conversation. This is small enough that it is nearly a Phase 3 task; it is here only because it is a product-naming call.

### Decision 4: Channels are built, unused, and will break under replicas

**Evidence:** `routes/channels.ts` has 12+ routes and `collaborationChannels` tables exist, but there is **no channel UI** — zero "channel" references in `CollaborationPanel.tsx`. The only realtime transport is `InMemoryRealtimeEventBus` (`realtime-event-bus.ts:3`), used solely by the OWUI compat shim. It is single-process: **channels cannot work across replicas.**

**Options:** (a) ship channels — needs a real transport (Valkey pub/sub; Valkey is already a dependency) plus the entire UI; (b) delete the channel backend as unshipped.

**This is a latent production bug** if channels ever ship without (a). **Recommendation:** decide before anyone builds channel UI on top of an in-memory bus.

### Decision 5: What GA actually means

**Evidence:** the project's own docs say "GA checklist remains 19 of 29 gates" with "the same ten target-environment blockers," and "UI polish remains open" recurs throughout `docs/backlog/current-status.md` (912 lines). After Phase 2, the checklist is measuring substantially less.

**The real question:** the ten blockers are all "target-environment" — they need a real cluster, real credentials, real monitoring. No amount of local code makes them pass. **Either** provision a target environment and run them for real, **or** stop counting gates that cannot be satisfied. The current state — a checklist that can never reach 29/29 from a laptop — generates activity without progress.

**Recommendation:** cut the checklist down to gates that can pass in CI, and track the target-environment ones as a separate, honest, human-owned list.

---

## Validation Strategy

How each phase is proven, and why the method fits.

| Phase | Method | Why this method |
|---|---|---|
| 0 | `git log`, staged-content secret grep | Secrets in history are permanent. Audit before the first commit, not after. |
| 1 | `pnpm verify` exit 0 + empirical hypothesis test | Every fix was diagnosed by changing one variable and observing the result (e.g. `2026-07-08` → `2099-07-08`), not by reading code and guessing. |
| 1.3 | Deliberately plant a rotted fixture and confirm the guard fires | A guard that has never failed is decoration. Prove it fires, then restore. |
| 2 | `tsc --noEmit` as the reference-finder + live 200/404 probes | The type checker finds dangling references exhaustively; a green Phase 1 baseline makes every new error attributable to the deletion. The tests covering these endpoints are deleted with them, so only driving the running app proves survivors work and the rest are gone. |
| 3 | Unit tests for pure logic + scripted browser checks for layout/interaction | Autoscroll, autogrow, and menu behaviour are not unit-testable in a meaningful way. The failure modes (yanking a scrolled-up user; appending instead of replacing) are only observable by driving the app. Each task's browser steps name the exact regression they catch. |

**Global gate — no task is done until this exits 0:**

```bash
cd /Users/mj/mjcode/ab/ab-live-products/romeo/romeo
pnpm verify
```

**Rollback:** every phase is tagged (`green-baseline`, `posture-removed`). To revert a phase wholesale: `git reset --hard <tag>`. This is the entire reason Phase 0 comes first.

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| A posture service has a consumer the audit missed | Low | Task 2.1 Step 1 audits before deleting and halts on any `!!` line; `tsc --noEmit` catches the rest exhaustively; `green-baseline` tag reverts. |
| Deleting an env var breaks Helm/Compose at deploy time, not build time | Medium | Task 2.3 Steps 5-6 render the chart and parse the compose file explicitly rather than trusting `tsc`. |
| The GA checklist chain breaks when its scripts are pruned | Medium | Task 2.4 is deliberately conservative: keep anything feeding `ga-evidence-posture-service`, which readiness depends on. Step 4 verifies every script target exists; Step 5 verifies CI. |
| Autoscroll fights the user | Medium | The near-bottom check is the core of the feature, not a refinement. It has a dedicated unit test and an explicit browser check (Task 3.1 Step 6, behaviour 2). |
| Regenerate appends instead of replaces | Medium | Task 3.4 Step 3 case 5 reloads and asserts the persisted history has no duplicate pair. |
| More fixtures rot mid-remediation | Low | Task 1.3's guard fails the suite the moment an `expiresAt` sits in the past. 705 date literals remain, but only expiry-compared ones can bite. |
| `field-sizing: content` would have been one line | Certain | Acknowledged in a ponytail comment at the code site. The JS is ~6 lines and works in every browser today; swap when support lands. |

---

## Summary

| Phase | Tasks | Outcome | Blocking? |
|---|---|---|---|
| 0 — Preserve | 2 | Under version control; toolchain runnable | **Blocks everything** |
| 1 — Green | 4 | `pnpm verify` exits 0 honestly; rot guard installed | Blocks Phase 2 |
| 2 — Delete | 5 | ~24,500 lines removed (~7.3% of repo) | Blocks Phase 3 (adjacency only) |
| 3 — Product | 4 | Chat is usable day-to-day | — |
| 4 — Decide | 0 | 5 decisions; up to ~5,200 more lines removable | — |

**Net:** ~24,500 lines deleted, three false failures fixed at root cause, four real product gaps closed, and the codebase in git. Phase 4's decisions gate roughly 5,200 further lines of deletion and every remaining product question.

**The single most important line in this plan is `git init`.** Everything else is recoverable.
