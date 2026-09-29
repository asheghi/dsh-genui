# DSH GenUI Design Optimization Plan

> Status: design draft (not implemented, not merged, not released)
> Basis: audit facts from `docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md`; code baseline is plugin repo `9b68c20` (v0.3.5), host `staging-20260811T152241Z`
> In one line: **fix every root cause the audit found, but change "hard prohibition + fixed numbers" wording into "safety boundary + tunable defaults + evidence-driven adjustment path", and do not delete or roll back any shipped capability.**

---

## 1. Design principles (replacing the original plan's "prohibited approaches" section)

The original plan wrote many engineering trade-offs as legal statutes ("must not use X", "must be ≤200", "must be serial"). This plan uses a different formulation: **three boundary classes, each managed according to its nature**.

| Boundary type | Meaning | Management | Examples |
|---|---|---|---|
| **Safety boundary** | Violating it leaks secrets, destroys user files, or pollutes other sessions | Not configurable, always holds | password values never enter localStorage; installer never follows symlinks; panel publishing never happens inside a render function; E2E never uses broad pkill |
| **Scale/performance boundary** | Prevents pathological input from freezing the page | Centralized in a single defaults table, tunable; adjustments require evidence | panel node cap, partial parse attempt cap, LRU block count |
| **Semantic boundary** | Which mechanism is semantically correct in which scenario | State the applicable scenario and the degradation path; no one-size-fits-all bans | A content fingerprint is the correct semantics for "restore state for the same content" and the wrong semantics for "message identity"—differentiate by scenario |

Three overall principles:

1. **Fix root causes, but skip technical purism**. When a mechanism (such as content hashing) is semantically wrong in scenario A and semantically right in scenario B, differentiate by scenario instead of blacklisting it wholesale. The original plan's "no random IDs, content hashes, or timestamps at any stage" was one-size-fits-all; this plan forbids only **semantically wrong usage**: random IDs/timestamps/`useId()` cannot serve as message identity (unstable), and a content hash cannot serve as message identity (two messages with identical content must be two independent operations)—but a content fingerprint as the content dimension of a `stateKey` (deciding "is this still the same content") is exactly the correct usage, already validated in production, and stays.
2. **Every quantity limit is centralized in one defaults table**, where the default = current shipped behavior, and any change requires evidence (benchmark, real sample, product confirmation) rather than being permanently locked down or casually loosened.
3. **No regressions**. Every shipped, demoed, test-covered capability is preserved: `scene3d`, all 38 components, append panels, local grading, durable persistence, the `/panel` command, and v1/v2/v2.5/v2.6/v2.7 semantics. Behavior changes on a safety boundary (such as password not persisting) must be a **degradation that does not break rendering**, not feature removal.

---

## 2. Audit facts (carried over from the original plan, baseline moved forward)

| Item | Current fact (v0.3.5 / 9b68c20) | Root cause |
|---|---|---|
| Panel append | `lastAppendSource` records "the last append source" | A→B→A duplicate append; when both messages have local key 0, the second is swallowed |
| Panel order | Fence publishes with `Infinity` | After one fence, `render_ui` for all finite seq values can no longer update the panel |
| Panel cap | Single operation repaired to 200 nodes, no total limit after merge | Repeated append rounds grow without bound |
| Forms | `TabsNode` does not pass through `answers` (the tabs branch of `renderNode` omits the argument) | Grouped radio / submit / grading inside a tab breaks the chain |
| State | `fenceStateKey(sessionId, localFenceKey, fingerprint)`, localFenceKey is not a session-level identity | Two messages at the same position with the same content → cross-wired state |
| IME | Input Enter / Textarea Ctrl/Cmd+Enter has no composition-state guard | Enter while selecting Chinese candidates is mistakenly submitted |
| Sensitive input | `password` is in the public spec, and anything with an id field goes to localStorage in plaintext | Model-driven UI can collect and persist secrets |
| partial | Rescans the prefix for every `}` + repeated `JSON.parse` | 24 KB pathological input is O(n²), about 1.68s |
| 3D | `scene3d-lazy.ts` has a permanent `requestAnimationFrame` | Continuously consumes GPU/battery while idle |
| Pointers | Panel drag and 3D orbit use window-level pointermove/up | Global listener leaks, residue after unmount |
| Installer | `cp` directly onto the target | Can overwrite user files a symlink points at |
| E2E | Log paths are declared but subprocess output is dropped; a local chip text change counts as "response" | No logs on failure, false passes |
| Build | CSS Modules classMap key order drifts | Repeated builds from the same source produce inconsistent artifacts |
| Package size | `files` includes `src`, sourcemaps, intermediate JS | Published package 4.82 MB / 25.16 MB, with a source escape hatch |
| Minimum version | README says `47d230e`, the actual manifest contract needs `0545fdcb`, and there is no FenceSource contract yet | Installing per the docs may fail to load |
| Remote CI | Three runs were blocked by Billing before runner allocation | No real gate remotely |

The original plan's root-cause diagnoses for all of these facts hold; this plan carries them over and **changes only the wording and flexibility of "how to fix"**.

---

## 3. Fence source contract (host side)

### 3.1 Contract shape (original plan's core retained)

```ts
export interface FenceSource {
  /** Stable structural identity, e.g. ['assistant', finalMessageSeq, textBlockIndex, fenceIndex] */
  id: string
  /** Three-part order: message seq, text block index, fence index */
  order: readonly [messageSeq: number, textBlockIndex: number, fenceIndex: number]
}

export interface FenceRenderContext {
  /** Owning session; absent when rendered outside a session */
  sessionId?: string
  source?: FenceSource
}

export type FenceRenderer = (raw: string, reactKey: Key, context?: FenceRenderContext) => ReactNode
```

- The host generates a stable `source` from the settled/interrupted `finalNode.seq`; during streaming, `source` is empty.
- `fenceIndex` must come from the stable fence order of the settled document, never from mount counts, random numbers, or time.
- Session ID travels via `context.sessionId`, not stuffed into `source.id`.

### 3.2 Softening changes (relative to the original plan)

1. **The third parameter is optional**. `context?: FenceRenderContext`, not required. Reason: during a contract upgrade there will inevitably be "new plugin + old host" combinations. When an old host passes no context, the plugin runs by explicit degradation rules (see 3.3) instead of crashing. This is not "a compatibility layer hiding the root cause" but the **standard smooth path for a contract upgrade**—the main repo and the plugin can each release independently, with no atomic coordination required.
2. **Source identity allows a best-effort degradation chain**. Prefer `['assistant', seq, block, fence]`; when the host cannot obtain a stable seq on some render path (e.g. stateless history log replay), it may degrade to the message's own stable key (such as message id) + block + fence. Degradation does not affect correctness: identity only needs to be **stable when the same source is replayed and distinguishable between different sources**; seq is merely the preferred implementation. The original plan's "must not use X to bypass this at any stage" is dropped, replaced by: **identity must satisfy the two properties "stable + distinguishable"; which fields implement it is the host's business**.
3. **No blanket hash ban for `source.id`**. If the host has stable message content addressing (rather than random/time), composing identity from it is equally legitimate—the properties just have to be right.

### 3.3 Plugin-side degradation rules (old host without context)

| Case | Behavior |
|---|---|
| `panel:true` and no `context.sessionId` | Do not write the panel store, do not persist; render `null` (a panel is inherently a surface that "exists only when there is a host session route") |
| Ordinary inline and no context | Render the UI normally; `stateKey` is `undefined` → do not write localStorage (consistent with current streaming behavior) |
| Has `sessionId` but no `source` (streaming) | Render inline UI; do not publish a panel, do not persist |
| Has `sessionId` + `source` (settled) | Full behavior: publish the panel / build stateKey from `sessionId + source.id + fingerprint` |

The plugin no longer depends on `active-session.ts` guessing the globally current session (that module is retired, see section 5), eliminating cross-session misdelivery entirely.

### 3.4 Host tests (original list retained, semantics unchanged)

Two settled messages both with local key 0 → different source.id; text block / fence dimensions distinguish; replaying the same message yields identical identity; two interleaved sessions do not cross-wire; streaming → settled produces exactly one stable source; an old host without context does not crash.

---

## 4. Panel operation model (plugin side)

### 4.1 Core model (original plan retained)

```ts
type PanelOrder = readonly [number, number, number]

interface PanelOperation {
  sourceId: string
  order: PanelOrder
  mode: 'replace' | 'append'
  spec: GenuiSpec
}
```

Each session stores:

- `Map<sourceId, PanelOperation>` (persistent message/tool operations)
- At most one **overflow barrier** (a copy of the first complete append rejected for exceeding the limit, so an earlier out-of-order replace arriving later can recompute)
- Local `/panel` override (a default panel, or clear + the maximum message seq masked through)
- A read-only collapsed snapshot

Publishing rules:

- Fence (settled + has context): `sourceId = context.source.id`, `order = context.source.order`, `mode = append | replace` (per spec.append). Publishing goes through a keyed publisher component + `useEffect`, and **never writes the store inside a render function**; the StrictMode double effect is deduplicated by the Map on sourceId.
- Tool result: `sourceId = ['render_ui', block.callId]`, `order = [block.seq, -1, 0]`, `mode = replace`. It enters the same pipeline as fences, deleting the second ordering rule.

### 4.2 Collapse algorithm (original plan's core retained, rewritten as "defaults + configurable")

On each first receipt of a new source, perform one transactional candidate collapse:

1. Source earlier than/equal to the local barrier → reject the stale replay.
2. `sourceId` already in the Map or exactly the barrier → idempotent return, no repeat notification.
3. A barrier already exists: appends no later than the barrier may enter candidate recomputation, later appends are rejected; replaces always enter the candidate set ("latest replace wins").
4. Use a temporary copy (without first modifying the real Map), sort ascending by the three-part order, collapse from the latest valid replace, and trim earlier operations.
5. `replace` replaces outright; `append` reuses the pure function `mergePanelSpecs` (tabs with the same label merge, everything else appends at the tail), and an append spec must have at least one valid node.
6. After each append, **reuse the same traversal** for node counting via the existing `validateGenuiSpec`; exceeding `PANEL_LIMITS.maxNodes` (default 200) → record it as the first overflow barrier, skip it and later appends, and keep the last legal snapshot. A second traversal is forbidden, and an over-limit spec must never be handed to React.
7. After the latest replace, keep at most `PANEL_LIMITS.maxAppends` (default 200) appends; the 201st requires a next replace under the barrier rules even if no nodes were added. This is the memory cap of the operation Map—**rejection rather than LRU eviction**, because eviction would break deterministic collapse (the result would depend on arrival order); that is a semantic reason, not a "no LRU" dogma.
8. Candidate snapshot, trimmed Map, and barrier are committed all at once only when every computation succeeds; a validation anomaly keeps the old state; notify once only when the snapshot actually changes.
9. After a later replace succeeds, clear earlier operations and the old barrier; clear everything when the session is destroyed.

### 4.3 Softening changes

1. **All caps are centralized in one table**:

```ts
export const PANEL_LIMITS = {
  maxNodes: 200,    // same value as GENUI_LIMITS.maxNodes, but independently tunable
  maxAppends: 200,  // number of appends allowed after the latest replace
} as const
```

  The original plan demanded "reuse `GENUI_LIMITS.maxNodes` directly, do not add another config item"—which is itself a form of rigidity: the panel total and a single spec's node budget need not always have the same value (a panel is a merged result and could in principle be given a higher budget). This plan allows the two to decouple, with the default value equal.
2. **The recovery path after exceeding the limit is explicit**: any replace clears the barrier and reopens appends (already in the original plan); system prompt/SKILL/diagnostics uniformly require "send a replace once the panel hits the cap". No virtual list is introduced (a panel cap is supposed to make the model change content, not stack it indefinitely).
3. **The tie-break rule is written down**: when the three-part order is identical (replay of the same message at the same position), the later arrival wins—this only happens on "a duplicate submission of the same operation", and after Map deduplication by sourceId there is no real ambiguity; it is written down so tests can assert it, adding no hidden ordering.
4. **Not all arrivals are required to be strictly ordered**. Out-of-order arrival (B before A) is handled naturally by the collapse algorithm; test coverage suffices, and callers are not forced to guarantee order.

### 4.4 `/panel` local command (retained)

`setLocalPanel / clearLocalPanel` as explicit local interfaces recording the barrier; the next later real operation can move past the barrier, while a stale history replay cannot revive the panel. No fake `Infinity`/`MAX_SAFE_INTEGER` message. During collapse, the local override acts as the base, then operations after the barrier are processed.

### 4.5 inline state identity (core retained + degradation path)

- streaming / no context: `stateKey = undefined`, nothing written to localStorage.
- settled + context: `fenceStateKey = sessionId + source.id + fingerprint(spec)`. The fingerprint serves only the **content dimension** (restore state for the same content, new key for new content), while source identity serves the **position dimension**—two dimensions with different semantics, each doing its own job.
- The top-level ErrorBoundary's React key uses `source.id ?? reactKey`; the ineffective duplicate key inside `GenuiBlock` is deleted.
- Panel component: `stateKey = panelStateKey(sessionId, JSON.stringify(spec))` computed once, serving simultaneously as the ErrorBoundary key and the GenuiBlock stateKey; a content change atomically rebuilds the whole tree (rather than clearing it in stages via `useEffect([stateKey])`).

`active-session.ts` is retired: panel targeting comes only from context.sessionId and the tool card's props.sessionId. On hosts without context, panel functionality is automatically unavailable (degradation); this is the cost of the contract upgrade and is documented explicitly in the README compatibility matrix.

---

## 5. Forms, state, IME, and sensitive-input boundaries

### 5.1 tabs passing through block-level answer state (retained)

The tabs branch of `renderNode` adds `answers={answers}`; `TabsNode` creates no new store/Context. Tests: grouped radio + input(id) + submit inside a tab, local grading lock/redo, state preserved across tab switches, payload containing both answers and fields.

### 5.2 Simplified answer state (retained)

Delete the never-read `AnswerEntry.label`: in-memory answers become `Record<string, string>`; `setAnswer` compares strings only; the question display reads solely from `QuestionMeta.label`; localStorage was already a string table, so no migration and no compatibility layer; the submit payload is no longer converted twice; the Radio React key includes `round`, and the "listen to round then setSelected" sync effect is deleted. Acceptance: v2.5/v2.6/v2.7 behavior unchanged, net code reduction.

### 5.3 Field invariants (retained)

- `value.trim() === ''` → delete that id from the shared `fields`; non-empty stores the user's original string, and the payload never trims on its own.
- On first mount, Input/Textarea register a non-empty `node.value` into fields.
- Submit's `answered`/`ready`/payload uniformly use the same `filledFields`, defensively filtering blanks.
- Do not unilaterally change "any non-empty field allows submit" into "all fields required".

### 5.4 IME protection (reusing the host's already-validated three-layer check, retained)

Input's Enter and Textarea's Ctrl/Cmd+Enter use the same three-layer protection as the host's main input:

1. `compositionstart` → set the composing ref;
2. `compositionend` → clear the ref after a 10ms delay (covering Safari's closing keydown order);
3. keydown checks the ref, `nativeEvent.isComposing`, and `nativeEvent.keyCode === 229` together.

This is "reusing a validated implementation", not a new invention. Tests: isComposing:true does not submit, keyCode 229 does not submit, Enter immediately after compositionEnd does not submit, an ordinary Enter after the delay submits exactly once, Textarea Ctrl/Cmd+Enter takes the same path. Real acceptance: on an isolated page, Chinese pinyin "candidates → Enter to pick → Enter again to submit", where the first Enter produces no model message.

### 5.5 Sensitive input: safe degradation rather than deletion (the key divergence from the original plan)

Original plan: delete the `password` capability (remove the type from the spec, drop the node in the guard, remove all teaching from the docs).
This plan: **keep the rendering capability, seal the data exit**. Reason: deleting the capability would make already-generated interfaces (history messages, external demos) vanish entirely or turn into plaintext text boxes after an upgrade, which is a user-visible regression; and the essence of the security problem is "a secret is collected + persisted", not "an input box has a password type".

Design:

1. **Rendering**: `inputType: 'password'` stays legal, and `<input type="password">` is masked by definition. The guard no longer drops the node (the original plan's worry about "silently removing the attribute and rendering a visible text box" does not exist—it was masked all along).
2. **Persistence**: `interaction-store` **skips writing** password fields—`saveBlockState` filters password input values out of `fields`; `loadBlockState` does not restore them either (the password field is cleared on every refresh, consistent with browser password-box semantics).
3. **Submission**: a password field value may be sent to the model in the action payload (explicit user input = authorization to use), but **it does not enter localStorage** or the submit `fields` collection?—here we take a middle path: **no persistence + no inclusion in the submit fields collection** (submit's fields are "form data collection", the same source as persistence), but a password input with an `action` can still be sent immediately. This turns the cost of "model UI collects passwords" from "silently written to disk" into "the user personally submits once", a controllable boundary.
4. **Teaching**: system prompt, SKILL.md, and README drop password teaching and add an explicit rule: **GenUI must not request passwords, API keys, access tokens, recovery codes, or other secrets**; any password appearing in examples is shown only as a placeholder.
5. **Tests**: a password spec renders as a masked input; the value is not restored after refresh; `localStorage` has no such field; the submit payload contains no password field; a malicious spec produces no visible plaintext.

This is a safe degradation of "capability retained + data exit tightened", satisfying "no regressions" while closing the real risk.

### 5.6 Honest click feedback (retained)

Button local chip text "responded" → "triggered" (it only proves the local event fired, without implying the model received it). `GenuiActionHandler` is not extended to a Promise; async success/failure state waits until the host provides a unified send-failure feedback channel. The existing catch at least records the error without action payload/secret values, plus session targeting, instead of swallowing it silently.

---

## 6. Parsing, 3D, and pointer performance

### 6.1 partial parsing: single forward scan + bounded attempts (core retained, cap configurable)

- A full `JSON.parse` at most once (the common path).
- A small pure candidate collector reads the raw text only once, left to right: correctly skipping strings/escapes, maintaining a bracket stack; when a valid object closes and the stack depth ≤ `GENUI_LIMITS.maxDepth`, it records `{ end, closingSuffix }`, and a ring buffer keeps the `MAX_PARTIAL_REPAIR_ATTEMPTS` (default 32) candidates in the longest direction.
- Balanced prefixes and unfinished candidates are merged and deduplicated in the same scan; after the scan finishes, parsing starts from the longest candidate. It is **forbidden** to call `scanBrackets(text.slice(...))` inside a `}` loop or to rescan any prefix.
- Reaching the attempt cap returns `null`, awaiting more streaming content or the settled fallback—this is the inherent rhythm of the streaming path, not a failure.
- No tokenizer dependency is introduced. The reason is stated plainly: a parser library is an overweight dependency for a "single forward scan + a few parses" scenario; **only when real streaming samples prove the recovery rate is insufficient** should we switch to a tokenizing parser on the evidence—that is an explicit adjustment path, not "never allowed to change".
- Tests: pathological 24 KB / 8000 closed-object input; the collector exposes a `scannedChars` diagnostic (not exported from the package entry), asserting it equals the input length and candidates ≤ the cap; spy on `JSON.parse` asserting total calls ≤ 1 full + N capped; a 20-run same-machine benchmark with P95 < 50ms as local evidence (no flaky CI assertion).

### 6.2 scene3d: keep the product capability, fix only the permanent frame loop (no regressions)

- **Do not delete scene3d** (already public, already demoed, used by gallery/demo). The original plan's deletion gate of "usage is 0 + product confirmation" is retained as an independent decision gate, but this plan does not trigger it by default—deletion is a product decision, not an engineering optimization.
- Event-driven rendering: render once after initialization completes; render once immediately after orbit updates the camera; pointer move (during drag) and wheel trigger orbit + render; 0 continuous animation frames when idle.
- Keep correct dispose of mesh/geometry/material/renderer.
- Tests: after initialization the renderer renders only once; sitting idle for one second adds nothing; one drag move and one wheel each add one; drag-zoom still works in headless Chrome; a Performance recording of an idle scene shows no continuous RAF.

### 6.3 Pointer Capture replacing global listeners (retained)

- Panel drag: `pointerdown` on the handle calls `setPointerCapture(pointerId)`, with move/up/cancel all bound to the handle; delete the window pointermove/pointerup registration/unregistration/cleanup effect; keep the 120–600px clamp, height memory after collapse, and accessible separator.
- 3D orbit: drag moves to canvas pointer capture (the canvas already owns pointer events, `wheel`'s `{passive:false}` retained), and scene3d's window listeners are deleted.
- Tests: dragging beyond the element's bounds stays continuous, pointercancel clears active, no further changes after release, no residue after unmount, and window pointer listeners no longer appear in the source.

---

## 7. Build, package size, installer

### 7.1 Deterministic build (retained)

Before constructing the CSS Modules classMap, sort by local class name with a fixed UTF-16 ordering (no `localeCompare`, avoiding locale differences; hash values unchanged, only key order fixed; no test-only production export added). Acceptance: 5 consecutive builds in the same clean worktree produce identical `shasum -a 256 lib/client.js`; artifacts built on macOS rebuild on Ubuntu CI with no diff.

### 7.2 Build directly from src, tsc emits declarations only (retained, atomic commit)

- `tsconfig.json`: `emitDeclarationOnly: true`; turn off `declarationMap`, delete the meaningless `sourceMap`; single package with no project reference → `tsc -p tsconfig.json`, delete `composite`/`incremental`, and no longer generate `.tsbuildinfo`.
- tsdown: client entry `src/client/index.tsx`; Node entries `src/plugin/index.ts`, `src/plugin/invariant.ts`; resolve CSS by source importer, deleting the `sourceAssetPath`/`existsSync`/`sep`/`lib/types` fallback; turn off sourcemaps for the production browser bundle; per the current tsdown types, rename `external`→`deps.neverBundle`, `noExternal`→`deps.alwaysBundle`, `inlineDynamicImports`→`codeSplitting:false`.
- Delete the intermediate JS/JS map/d.ts map under `lib/types`; keep the d.ts files and the three top-level runtime JS files.
- Acceptance: `node --check` on the three JS files; `test -z "$(find lib/types -type f \( -name '*.js' -o -name '*.map' \) -print -quit)"` (on failure print the full find output to help locate it); tsdown reports no deprecated configuration warnings.

### 7.3 Classify dependencies by the real runtime boundary (retained)

`mermaid`, `three` → devDependency (already inlined, needed only for builds); `react` → peer + dev; `react-dom` → dev only (zero imports in the source, delete the peer); DSH internal packages + cordis → peer. Remove `react-dom`/`react-dom/client` from EXTERNALS that are not actually imported; update the lockfile; fix the docs' outdated claim that "git/link installation must download Mermaid/Three/React"; verify the production bundle has no `require('mermaid')`/`require('three')`/`require('react-dom')`. **Do not overstate bundle gains** (the 9.02 MB main bundle will not shrink from dependency reclassification).

### 7.4 Toolchain (softened)

```json
{
  "packageManager": "pnpm@11.7.0",
  "engines": { "node": "^22.19.0 || >=24.0.0", "pnpm": ">=11.7.0 <12" }
}
```

- Writing the currently locked version in `packageManager` is corepack convention (it constrains only corepack users, and `corepack use` can change it at any time), so it is not a rigid lock; engines uses a range.
- Install scripts **do not automatically modify the user's global toolchain**: when pnpm does not satisfy the requirement, print an explicit command and fail (as in the original plan), but do **not** run `corepack enable`.
- CI and local both go through `corepack pnpm`, never falling back to a bare pnpm on PATH—this is an executable convention, not a design dogma.

### 7.5 Published package surface (core retained, thresholds configurable)

- Delete `exports['./src/*']`; keep `exports['./package.json']` (both the installer and DSH client module discovery must resolve the package manifest).
- `files` becomes an explicit allowlist: `lib/index.js`, `lib/invariant.js`, `lib/client.js`, `lib/types/plugin/index.d.ts`, `lib/types/plugin/invariant.d.ts`, `lib/types/client/index.d.ts`, `SKILL.md`, `README.md`, `CHANGELOG.md`, `demo-prompts.md`, `cordis.patch.yml`. `package.json`/`LICENSE` are force-included by npm and are listed in the pack-check allowlist.
- Add `scripts/verify-pack.mjs`: read `npm pack --dry-run --json`, assert that the JS and type entries for the three runtime exports exist, that the `./package.json` export resolves, that there is no `src/`/`.map`/`.tsbuildinfo`/`lib/types/**/*.js`, that the tarball is < 3 MB and the unpacked size < 10 MB. **Thresholds support environment-variable overrides** (such as `GENUI_PACK_MAX_TARBALL`), with defaults = this plan's targets; on an unknown file or an over-limit result, list the actual entries rather than silently loosening the check.

### 7.6 Installer file safety boundary (retained—safety boundaries are not configurable)

The installer first validates that the profile argument contains only allowed characters; it parses paths in Node using environment variables, never interpolating user paths into a `node -e` string. Skill sync classification:

| Target state | Behavior |
|---|---|
| Does not exist | Same-directory temp file + atomic mv create |
| Regular file | Same-directory temp file + atomic mv replace |
| symlink resolving to the same file as the source | Skip successfully, do not change the link |
| symlink pointing at another file | Fail safely, show the target, do not follow and write |
| Dangling symlink | Fail safely |
| Directory | Fail safely |

- No more direct `cp`; temp files must be cleaned up on abnormal exit; conflicts and a missing in-package Skill must exit non-zero; a missing pnpm must not auto-run `corepack enable`.
- Tests: temporary `DSH_HOME`, fake `dsh/pnpm/git`, a real shell driving the seven scenarios; the most critical case asserts "the sentinel file bytes a different target symlink points at are unchanged".

---

## 8. E2E, CI, docs, and release

### 8.1 E2E preflight (retained)

Before starting any process: `--install` limited to `link|tarball|git`, where tarball must provide the absolute path of an actual `.tgz` + the expected SHA256; the port must be valid and free (when unspecified, allocate one via the Node standard library); `--dsh-root`/`--dsh-bin` must be absolute paths with `realpath(dsh-bin)` inside `realpath(dsh-root)`; do not look up `dsh` on PATH by default; record `git rev-parse HEAD` and require it to match the declared host SHA; print the host SHA, plugin SHA, and Node/pnpm versions at the top of the log, without printing any key; check that the host contains the fence source contract; the link mode has the three entries present, the tarball file matches its SHA, and git mode pins a full ref; absorb the existing `scripts/e2e.mjs` WIP (filechooser select a temporary workspace, wait for the composer to leave inert/disabled, on timeout save a screenshot and logs and fail, never a `.catch(() => {})` false tolerance); full model mode requires a key but never prints it, and `--smoke` does not require one.

### 8.2 Real logs and narrow cleanup (retained)

web stdout/stderr genuinely written to `webLog`; on startup failure output the log tail; cleanup in `finally` (not relying on `process.on('exit')`); first terminate the exact child/process group normally, and only force-kill after a timeout; no broad `pkill`, and do not touch the user's existing 3080 listener; on failure retain/copy logs and screenshots to stable artifacts, and only clean the temp directory on success.

### 8.3 Eliminating false action passes (retained)

Before clicking, record the `data-chat-flow-key` of the last `[data-chat-flow-kind="assistant-step"]`; wait for the current assistant to finish (no `[data-streaming]`); click; a new assistant-step key must appear with the new node ending streaming, **or** a panel snapshot driven by a new operation source must appear; a button chip alone / the same DOM text changing does not count as a response; `pageerror`, a client.js 404, and a new-reply timeout all fail. git installation pins `--ref <full SHA>`.

### 8.4 Two-layer E2E (retained)

`--smoke` (every PR, no model quota: host binary, install, profile, home page 200, client.js 200, no page exceptions, plugin boot) + full E2E (manual release gate, protected key: model fence, UI, action message, real new assistant reply, panel update). Full E2E must test three paths against the same host SHA: link candidate, tarball + SHA256, git pinned plugin SHA. The tarball path carries the ordinary fence, Mermaid, scene3d, and real profile loading acceptance deferred after 7.2.

### 8.5 CI matrix (softened)

- Unified `DSH_ROOT` (CI computes a canonicalized absolute path before cloning; after checkout assert rev-parse equals the target SHA; `DSH_BIN` pinned to the built absolute path; vitest.config actually reads `process.env.DSH_ROOT`, using the local path only as a default; while stage 1 is unmerged, generate a run-only paths override under `/private/tmp`, never commit a machine absolute path; preflight with `test -f "$DSH_ROOT/packages/client/ui-primitives/src/index.ts"`).
- **Default matrix** (not "must be two"): Node 22.19.x + minimum host SHA (minimum support line) + Node 24.x + current main (forward integration). Each matrix entry runs a frozen install, type check, full test suite, build, pack check, lib drift, and no-key smoke. The number of matrix entries is the release owner's default choice and may be added to or removed per the actual support surface.
- If Billing is not restored, report honestly that "local and PR are complete, the remote release gate is blocked", without skipping and then claiming completion.

### 8.6 Documentation fact corrections (retained)

README: delete the "commit >= SHA" phrasing; write "requires a DSH version containing the stage 1 host commit `<SHA>`"; the history note points out that `0545fdcb` is the minimum for the old manifest contract but does not satisfy the FenceSource contract; delete the hard-coded "135 tests"; "the panel can grow without bound" → "the whole panel defaults to at most 200 nodes, and a replace should be sent once the cap is reached"; delete the outdated claim that git/link requires downloading Mermaid/Three/React; delete password teaching and add the secrets prohibition; update the E2E commands and the smoke/pinned-SHA explanation. CHANGELOG keeps historical numbers without fabricating them; SKILL.md and the system prompt stay in sync: stable panel semantics, node/operation cap defaults, password not persisted, replace after append reaches the cap.

### 8.7 Release candidate (compatible tuple retained, numbers not locked)

`HOST_SHA` (containing the stage 1 contract, already on a supported branch) + `PLUGIN_SHA` (containing version/changelog/lockfile/deterministic artifacts). Strict order: host contract lands on the supported branch first → plugin fully complete → version 0.4.0 finalized → rebuild and retest from a clean SHA → remote matrix → git path E2E → **stop at PR/candidate without authorization** → after merge, re-read the actual `PLUGIN_SHA_FINAL` and rerun all evidence → freeze the single release tuple → after authorization create the tag/Release → only after installing into a fresh `DSH_HOME` + exact `DSH_BIN` and validating does it become official. 0.3.x gets no retroactive historical tags. Both version numbers and numeric thresholds are defaults, aligned with release facts.

**Release channel red line (user confirmed 2026-08-12)**: the host is still in its testing period, so **any public distribution channel such as npm/Workshop is entirely unavailable**—`npm publish` would make the plugin (and the existence of the host ecosystem) public, and is explicitly forbidden. `npm pack`/`verify-pack.mjs` only do local tarball verification and never publish. Distribution goes solely through a **private Git URL** (`git+ssh`, or a private registry to be confirmed separately by the release owner). Public docs shipped with the package, such as the README, must not contain host-internal information (host SHA, snapshot names, contract implementation details).

---

## 9. Difference table vs. the original plan

| # | Original plan (rigid wording) | This plan (softened wording) | Rationale |
|---|---|---|---|
| 1 | "No random IDs, content hashes, timestamps, or compatibility layers at any stage" | Differentiate by semantic boundary: identity must be "stable + distinguishable"; hashes may be used only for the content dimension; a compatibility layer serves only as the smooth path during a contract upgrade | A blanket ban would damage correct usage (a fingerprint is by definition the content dimension of stateKey) |
| 2 | `FenceRenderer` has three required parameters, switched all at once | The third parameter is optional, with an explicit degradation chain on the plugin side | New plugin + old host combinations do not crash, and the main repo and plugin can release independently |
| 3 | Panel "reuses maxNodes=200 directly, no new config" | `PANEL_LIMITS` as an independent table, default 200, decouplable | The merged total and a single operation's budget have different semantics; tuning by evidence is allowed |
| 4 | The 201st append / the 201st node: always rejected | Rejection + barrier + replace recovery path + configurable cap | A cap is a performance boundary, not law; the recovery path already exists |
| 5 | "No LRU introduced" | Reject rather than LRU-evict, with the semantic reason stated (eviction breaks deterministic collapse) | Same conclusion, but it gives a reason rather than a prohibition |
| 6 | Delete the password capability | Keep masked rendering; values are not persisted and do not enter submit fields; the teaching layer bans secrets | Not deleting a capability = no regression; sealing the data exit = safety boundary |
| 7 | Fixed 32-parse cap | `MAX_PARTIAL_REPAIR_ATTEMPTS` defaults to 32, configurable | Performance boundaries are tunable |
| 8 | scene3d deletion gate (usage is 0 + product confirmation) | Keep scene3d; the deletion gate is an independent product decision gate, not triggered by default | No regression of a shipped capability |
| 9 | pnpm@11.7.0 pinned, fail immediately on mismatch | packageManager locks the current version (corepack convention) + engines range; on failure give the command without auto-changing anything | The toolchain can be upgraded, and the convention stays executable |
| 10 | pack thresholds <3MB/<10MB hard-coded | Same defaults + environment-variable override | Scale boundaries are configurable |
| 11 | CI matrix "set up two blocking matrices" | Two matrices by default, adjustable per the support surface | The release owner's default choice |
| 12 | "Must proceed serially through stages 0→6, and must not modify the same core file in parallel across stages" | Dependencies retained, physical order relaxed: changes touching disjoint files may run in parallel; a core-file conflict matrix constrains the rest | Serial execution is a project-management preference, not a design-correctness requirement |

**Parts that stay unchanged** (root-cause fixes, where the original plan was right): panel operation Map + three-part ordering + transactional collapse; publishing never inside a render function; StrictMode deduplication; `/panel` barrier; tabs passing through answers; deleting AnswerEntry.label; field invariants; three-layer IME protection; single forward-scan partial; event-driven 3D; pointer capture; fixed CSS ordering; direct src build + declarations only; dependency classification; installer safe failure across the seven target kinds; E2E preflight/real logs/false-pass prevention; documentation fact corrections; the release compatibility tuple and the authorization gate.

---

## 10. Delivery order (by dependency, not forced physical serialization)

Dependencies (DAG):

```
host FenceSource contract ──► plugin panel operation model ──► forms/state/IME/sensitive input ──► parsing/3D/pointers ──► build/package/installer ──► E2E/CI/docs/release
```

Execution rules (replacing "proceed serially"):

1. **Same-file conflict matrix**: `GenuiBlock.tsx` is exclusively owned by the forms stage; `index.tsx`/`panel-store.ts`/`panel.tsx` are exclusively owned by the panel stage; `parse-partial.ts`/`scene3d-lazy.ts` are exclusively owned by the performance stage. At any moment a core file is held by only one change branch—this is the minimal anti-conflict constraint.
2. **Dependent tasks must wait for upstream**: the panel model depends on the host contract landing (or implement the degradation chain from 3.3 first + old-host tests, then complete the full test suite after the host merges—both paths are legal, just write down which one).
3. Build/package/installer are independent of the host and can run in parallel with the panel stage.
4. Each stage delivery = targeted tests + full test suite + green typecheck + green stage acceptance command; acceptance criteria are in section 11.

---

## 11. Tests and acceptance (defaults + configurable verification)

All test case lists from the original plan are carried over (panel append/replay/order/cap/StrictMode, state isolation, IME, partial, 3D, installer, E2E false-pass prevention), with the following added/replaced:

| Case | Assertion |
|---|---|
| password rendering | masked input DOM exists, not plaintext |
| password persistence | value not restored after refresh; localStorage has no such field; submit payload contains no password field |
| old host without context | the plugin renders inline without crashing, writes no panel, writes no localStorage |
| configurable cap | after injecting a `PANEL_LIMITS` test value (e.g. maxNodes=5), over-limit behavior follows the configuration |
| same-order tie-break | later arrival wins; after Map deduplication by sourceId there is no ambiguity |
| event-driven 3D | render once on init, no increase while idle, one each for drag/wheel |
| configurable parse cap | after injecting a small cap, parse call count ≤ 1 full + the injected value |

Stage gate commands and 7.x acceptance commands follow the original plan (`vitest run`, `tsc -b`, `tsdown`, `verify-pack.mjs`, lib drift, 5 consecutive builds with identical SHA), with "pnpm version exactly equals 11.7.0" changed to "corepack pnpm --version satisfies the engines range".

## 12. No-regression checklist (tick each item at acceptance)

- [ ] `scene3d` rendering, drag, zoom, and dispose are all retained; only the permanent RAF is removed
- [ ] 38 component types, the guard allowlist, and the gallery count are not reduced by a single item
- [ ] append panel semantics (tabs merged by label, tail append) retained
- [ ] local grading (submit grades in place, lock, re-answer) retained
- [ ] durable persistence (restore on same content, clear on content change) retained, except for password
- [ ] `/panel`, `/panel clear`, `/panel <instruction>` retained
- [ ] all existing v1/v2/v2.5/v2.6/v2.7 tests retained and kept green
- [ ] no existing 208+ tests deleted (only add or fix assertions for wrong old expectations, such as Infinity always winning)
- [ ] installation still goes only through the bundle (`cordis.patch.yml` inserts itself only once, the profile patch stays `[]`)
- [ ] do not touch the active 3080 service or the user's browser (E2E runs entirely in isolated environments)
- [ ] without release authorization, stop at PR/candidate: do not merge, do not tag, do not publish

---

## 13. One-line summary

> Fix every root cause the audit found, not one short; **safety boundaries are not configurable, scale/performance boundaries are centrally configurable, semantic boundaries are stated per scenario**; capabilities are only degraded, never deleted, and behavior is only tightened, never rolled back; stages advance by dependency without forced serialization. Every "prohibited approaches" section of the original plan is rewritten as "rationale + defaults + adjustment path".
