# dsh-prompt-refine 0.2.9 — prompt armor

0.2.9 adds one host-side feature and no behaviour change to enhancement itself.

## Prompt armor (`armorEnabled`)

A block of operator-written text placed above every section the host assembles for a turn. Off by default.

- Section name `prompt-enhance-armor`, `order` = `armorOrder` (default `-100000`), `interpolate: false`.
- Body source: `armorFile` (default `~/.dsh/prompt-inject.md`) when it exists and is non-empty, else `armorText`. `~` and `${DSH_HOME}` expand; mtime-cached so edits apply on the next turn.
- Registered through `ctx.systemPrompt.section()` where the host exposes that seat, and through the `system-prompt/assemble` waterfall event otherwise; both dedupe on the section name.
- A body already injected verbatim by another plugin (e.g. `dsh-purge` reading the same file) is not duplicated.
- `{{model}}` / `{{provider}}` pass through interpolation; every other `{{variable}}` is escaped to `{ {variable} }`, because an unregistered token is a hard prompt-assembly failure on this runtime.

## What this is not

Not a permission change. The armor edits the prompt only: no `app.asar` patching, no approval-mode defaults, no sandbox widening, no extra tools. If you want those, they are `dsh-purge`'s business, not this plugin's.

## Settings

Four fields join the plugin's own settings page: `armorEnabled`, `armorFile`, `armorText`, `armorOrder`. They are host-side, so they are not mirrored into the browser half's `ClientSettings`.

## Tests

462 across 33 files, including the new `tests/armor.test.ts` (28 cases).
