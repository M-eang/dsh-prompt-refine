## Workspace grounding, and the record behind the wording

This release publishes what `0.2.8` already carried as a local build — the
workspace-aware layer — together with the declaration corrections and the
behaviour changes below. `0.2.7` was the last release npm served as `latest`.

### What is new since 0.2.7

**Workspace-aware enhancement.** The rewrite is grounded on the session's working
directory as well as its conversation: `src/workspace.ts` walks `session.header.cwd`
through `ctx.fs` (`resolve` / `listDir` / `readText`), lists the directory
structure, and reads bounded excerpts of the highest-ranked files into a
`<workspace_context>` block placed after `<conversation_context>` and before
`<raw_prompt>`. `WORKSPACE_SYSTEM_ADDITION` rides along only when such a block
exists, under the same contract the conversation layer already used: the context
is evidence, the raw prompt wins, and a path that is not in the block is never
invented.

Vendor/build directories and binary/media extensions are skipped, obviously
secret-bearing names (`.env*`, `*.key`, `*.pem`, `credentials*`, `id_rsa*`, …) are
skipped before a byte is read, and text carrying a NUL byte is dropped as binary.
Every failure path (no session, no `fs` service, no working directory, unreadable
root, provider throw, cancellation) yields `undefined` and runs the previous
single-layer behaviour; the host log line reports `ctx=0|1 ws=<files>`.

**A scan is reused for 10 seconds.** Keyed on the `fs` provider, the session
object, the resolved root and the configured bounds — so a cache hit can only
answer the question the scan was just asked. A failed or empty scan is never
remembered (fail-open is unchanged), and `workspaceAware = false` disables the
layer and the cache together. Motivation: the common retry pattern — a timeout or
a provider error, then a second click — re-listed the tree and re-read up to
`workspaceMaxFiles` excerpts for nothing.

**Grounded calls say so.** The success envelope carries
`evidence: { history, workspace, files }` and the panel renders one quiet line
naming the layers. It is omitted entirely when neither layer applied, so an
ungrounded call keeps the byte-identical shape older hosts produced; the browser
half parses it tolerantly in both directions. Purpose: the privacy boundary —
what leaves the machine with the draft — becomes visible instead of inferred.

**Refusals and local failures are localizable.** A routed refusal answers
`params.reason` (`content-type` / `body-too-large` / `invalid-json` /
`invalid-body` / `disabled`) with no prose, and the browser half renders the line
from its dictionaries (`REJECTED_REASON_KEYS`); the browser's own failures carry a
dictionary `detailKey` instead of Chinese `message` text. One diagnostic stays
untranslated by design: `internal` still carries the settings validator's own
message, because which invariant failed is only known there and the plugin's
settings descriptions are Chinese at the source. The three route-shape guards
(non-loopback, unknown subpath, non-POST) keep their machine-readable English
diagnostics; a same-origin browser POST cannot reach them.

**The built artifact is checked off-machine.** `tests/preflight-built.mjs` loaded
`lib/index.js` through an absolute, URL-encoded path from the machine that wrote
it, so the only test that exercised the committed bundle could not run anywhere
else. It now resolves the bundle relative to the script, and `npm run preflight`
is a step in CI (after the build) on a Node `22.19` / `24` matrix.

### Behaviour changes (upgraders: read this)

| Field | `0.2.7` | `0.2.8` | Effect |
|---|---|---|---|
| `maxOutputTokens` | `2048` (schema `min(256)`) | `0` (schema `min(0)`) | No output cap of ours is sent; the harness adapter's or the provider's own maximum applies. A stored positive value keeps capping exactly as before. |
| `contextMaxMessages` | `8` | `12` | Up to 12 recent turns may ground the rewrite. |
| `contextMaxChars` | `4000` | `8000` | The history snippet's character budget doubles. |
| `workspace*` | absent | 7 new keys, `workspaceAware: true` | The working directory's structure and bounded file excerpts are sent to the configured model provider by default. |

The `0.2.7` column was read from the published bundle (`dsh-prompt-refine@0.2.7`
`lib/index.js`: `maxOutputTokens: 2048` with `min(256)`, `contextMaxMessages: 8`,
`contextMaxChars: 4000`, and no `workspace*` key), not inferred from prose.

### Decisions recorded

**C1 — `maxOutputTokens` default `0`, not `4096`.** The 0.2.8 changelog draft
claimed the default moved to `4096`. The released value is **`0`** — no cap of
ours: `src/config.ts` (`DEFAULT_CONFIG.maxOutputTokens = 0`), the schema
(`0–32768`), `tests/config.test.ts` ("ships maxOutputTokens as 0 — no cap of
ours"), and both READMEs' configuration tables all already agreed, and the
sentences explaining the value (`0` sends no maximum; a gateway that injects
thinking spends an explicit cap on reasoning too) were written for `0`. The
`4096` sentence was removed from the entry rather than carried beside the code,
because a release note and the shipped schema must not disagree. If `4096` was
the intent, the flip is a code + test + README change and belongs in a release of
its own.

**E1 — the range stays, the claim about it is corrected.** `dsh.engines.dsh`
remains `>=0.1.1-rc.2 <0.3.0`; what was wrong was the README sentence saying the
ceiling "covers the whole `0.2.x` line (including its prereleases)". Under npm
semver a prerelease only satisfies a range whose comparator set names a
prerelease with the same `major.minor.patch` — the rule `0.2.5` itself relied on
— so `0.2.0-rc.2`, the desktop build this plugin runs on day to day, is **not**
matched by the range as written. It *is* matched by consumers that evaluate the
declaration with prereleases included, which is how the plugin market's discovery
check reads it (`satisfiesRange(host, range, { includePrerelease: true })` in the
installed `dshmarket` discovery module). The field is advisory metadata and does
not gate loading: this plugin is mounted and enhancing on `0.2.0-rc.2` today. A
range that names the prereleases
(`>=0.1.1-rc.2 <0.2.0 || >=0.2.0-rc.2 <0.3.0`) was considered and deferred —
how the loader itself parses the field has not been verified, and changing a
declaration that is proven to load is not a documentation fix. Both READMEs now
state the coverage in those terms.

**C2 — `workspaceAware` stays `true`.** Flipping a default is a behaviour change
of its own, and the review question was answered on the disclosure side instead:
the release notes, the configuration row, and the security sections of both
READMEs now say plainly that the working directory's structure and bounded
excerpts are sent to the configured model provider, and the panel names the
layers per call.

**E2 — the alpha line stays undeclared.** npm's `alpha` dist-tag is
`0.2.1-alpha.2`; the declared range does not name it and no host running it has
been exercised. Declaring support without a boot check would be exactly the
over-promise `0.2.5` removed. (待确认: boot-check `0.2.1-alpha.2`, or leave it out
of the claim.)

### Verification

- `npm run typecheck` clean.
- **279 tests across 21 files** pass (`vitest run --exclude '**/node_modules.dev/**'`;
  the exclusion only exists because this checkout exposes its dev tree through a
  junction named `node_modules.dev` — see CONTRIBUTING.md).
- `lib/` rebuilt, and `lib/index.js`, `lib/client.js`, `lib/index.js.map` are
  byte-identical to a fresh build (SHA-256 compared, as CI's own gate does).
- `npm run preflight` passes and is a CI step; CI also runs the suite on Node
  `24` beside the `22.19` floor.
- Not re-verified on a live host in this round. The desktop profile links this
  checkout, so the rebuilt `lib/` loads on the next dsh restart; the last live
  evidence on `0.2.0-rc.2` predates these changes
  (`[prompt-enhance] 85936f99 in=6 out=744 ctx=1 ws=5 6386ms ok`).

### Release mechanics

- This version is published as the **`0.2.8` already in `package.json`**; do not
  run `npm version patch` for it (that would mint `0.2.9` and skip the number that
  the changelog entry, the READMEs and the release notes all describe). Tag
  `v0.2.8` on the release commit and publish from there.
- Cut the release from the canonical clone: the checkout this record was written
  in had no remote and no tags (a baseline import of the working copy), so a tag
  created there would not belong to the published history.
- The desktop profile installs this plugin as a junction to the checkout. A
  profile-level `npm install` with a leftover `^0.2.x` spec still replaces the
  junction with the npm release; after this release that install carries the
  workspace feature too, so the failure mode is no longer "silently lose the
  local fix".
- `files` includes `docs/`, so this record ships inside the npm tarball (a few
  KB per release). Kept deliberately for now.

### Out of scope this round

`F2` (configurable scan exclusions), `F3` (streaming/cancel on the `/enhance`
command plane — the upstream affordance is unverified), `F4` (draft-aware file
ranking), `I3` (the model-facing framing and block headers are Chinese regardless
of the draft's language — priority 中低, and it would break the "byte-identical
instructions without context" contract) and `I4` (localized settings
descriptions — depends on whether the settings surface renders per language).

Three further dispositions, recorded here so they are not re-litigated from
memory:

- **`body-too-large` is locked by status and vocabulary, not by its envelope.**
  The refusal is written by the same `refused('body-too-large')` call as its
  siblings, and both of its paths (the `Content-Length` fast reject, the
  chunked-body backstop) deliberately destroy or complete the socket, so reading
  the 413 body would race that teardown. If the socket policy ever changes, the
  envelope becomes readable and should then be asserted — that would be a
  behaviour change with its own release note.
- **`.env.example` stays unreadable.** `TEXT_EXT_RE` lists it as readable text,
  but the secret-name gate runs first and wins; `tests/workspace.test.ts` locks
  that precedence. Reversing it changes what the scan may send to the model
  provider, so it is a behaviour change: it needs its own version and release
  note, and an exact-filename exception is the shape it would take.
- **No Windows CI job yet.** The suite runs on `ubuntu-latest` with Node `22.19`
  and `24`. One thing to fix *before* trusting a second platform's verdict:
  `scanWorkspace` orders entries with a bare `localeCompare` (`src/workspace.ts`),
  which is runtime-locale dependent, while `tests/workspace.test.ts` asserts exact
  ordering — pin the comparator first (that check is unverified today; no failure
  has been observed).
