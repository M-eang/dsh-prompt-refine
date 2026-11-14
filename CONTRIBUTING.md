# Contributing

Thanks for helping improve dsh-prompt-refine! This is a [DeepSeek Harness](https://github.com/deepseek-ai) web plugin: one npm package with a Node (host) half and a browser half.

## Setup

```bash
git clone https://github.com/M-eang/dsh-prompt-refine.git
cd dsh-prompt-refine
npm install
npm test          # unit + real-http + component suites
npm run typecheck
npm run build     # tsc + esbuild → lib/index.js (host ESM) + lib/client.js (browser ModuleLoader bundle)
```

### Dev dependencies live in `node_modules.dev`

In this checkout the installed dependency tree sits under **`node_modules.dev`** and is exposed to every tool through a junction named **`node_modules`**. Both names are git-ignored, and both are dependency trees — neither is ever committed, and neither is edited by hand.

```powershell
npm install                                    # creates node_modules/ (the real tree)
Rename-Item node_modules node_modules.dev      # park it under a name pnpm will not take
New-Item -ItemType Junction -Path node_modules -Target node_modules.dev
# on POSIX: ln -s node_modules.dev node_modules
npm test                                       # node_modules/.bin resolves through the junction
```

Why the indirection: `dsh plugin --profile <profile> install` (pnpm) owns the name `node_modules` and rewrites that directory on every install, so a dev tree sitting there would not survive it. Parked at `node_modules.dev` it does, while `node_modules` — the name npm, `node` and the dsh plugin loader all resolve — keeps pointing at it. The runtime dependency (`schemastery`) and the build toolchain (`typescript`, `esbuild`, `vitest`) resolve through that junction, so deleting it breaks both loading and building; if the tree is ever lost, `npm install` plus the two lines above re-create it.

One local gotcha: `vitest run` collects its default `**/*.test.*` glob, and `node_modules.dev` is not named `node_modules`, so the dependency tree's own test files are collected as well (hundreds of unrelated cases, some of which fail on this machine). Scope a local run:

```bash
npx vitest run --exclude '**/node_modules.dev/**'   # or: npx vitest run --dir tests
```

CI checks out a plain `node_modules` tree and needs no such flag.

## Local debug loop

```bash
dsh plugin --profile web add link:C:\path\to\dsh-prompt-refine   # once
npm run watch                                                     # keep rebuilding both halves
# restart `dsh web` after changing host-half code; browser-half changes
# need a page reload (and a rebuild first)
```

When you're done, switch back to the npm install for daily use:
`dsh plugin --profile web add dsh-prompt-refine`.

## Ground rules

- **`lib/` is committed** so GitHub installs need no build step. Always run `npm run build` before pushing — CI fails if `lib/` drifts from `src/`.
- Keep the two convergence invariants intact: client guards and the host route must agree through `src/shared/`; the HTTP route and `/enhance` command must both go through `src/orchestrate.ts`.
- The host route is loopback-only by design (see the Security Model section of the README). Don't add auth-bypass or network-listening changes without discussion.
- New user-visible strings go into **both** dictionaries in `src/client/locales.ts` (zh is the key-set source of truth).
- Tests: `npx vitest run` — prefer a regression test alongside any bug fix. Component tests use jsdom + React Testing Library with a fake input store; host-route tests use a real `node:http` server with a stubbed `ctx.llm`.

## Submitting

1. Branch from `main`, make your change with tests.
2. `npm run typecheck && npm test && npm run build` — all green.
3. Open a PR describing what changed and why; CI must pass.
4. Maintainers cut releases (`npm version patch|minor|major` → build → push tags → npm publish); see the Release process in the README.
