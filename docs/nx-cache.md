# Nx execution and cache policy

All targets are explicitly **uncached**, including lint, typecheck, unit and
unsigned Desktop compilation. `nx:run-commands` defaults to `cache: false`.
There is no affected skipping or CI selection change. The original npm
commands and full validator do not depend on Nx.

## Inputs and outputs

The named `workspace` input conservatively covers tracked and nonignored
untracked files across nested projects. It includes root/Desktop/site manifests
and their independent locks, root and project configuration, all source,
source-library dependencies, extension resources, fixtures and tooling. `.nx`
is excluded. This intentionally over-invalidates; ignored or checkout-external
mutable inputs are not a complete cache contract.

Lint and typecheck declare `outputs: []`: ESLint uses no disk cache and
TypeScript uses `--noEmit` without incremental state. Desktop build declares
`apps/desktop/out`; site build declares `apps/site/dist` and
`apps/site/public/og.png`. These declarations describe fresh outputs, not a
cache-restoration guarantee. Deleted-output restoration is inapplicable to
output-free checks and is not promised for uncached builds.

## Why caching stays disabled

The pinned Nx 23.2.1 runtime hasher can hash a runtime-command failure rather
than reject the task. A pre-lookup fingerprint experiment rejected NODE_PATH,
but Nx executed the check successfully and a repeated forbidden invocation
hit that cache entry. Therefore a runtime-input exception is **not** a
fail-closed cache guard. The rejected experiment is not production machinery.

Any future cache proposal must prove a real pre-lookup/read/write boundary,
not a command-time guard or a nonce. NODE_OPTIONS, NODE_PATH and npm shell/node
configuration can reference mutable external code. Hashing only their strings
is insufficient. Supported environment, OS/architecture, Node version/ABI,
Electron/tool versions, own-install origins and consumed untracked or ignored
configuration must be modeled before any target becomes eligible.

Desktop build additionally has three Vite roots, mode/env files and injected
overrides. Site build has font/Sharp/social-image side effects. Unit suites
consume subprocess, git, install and native state. E2E, DB lifecycle, native
rebuild, install, interactive, probe, provider, package, sign, release and deploy
operations are never cache candidates here. No node_modules, credentials,
session/pi/browser homes or DB data are cache outputs.

## Resource bounds

Nx runs at most three tasks by default. Every Nx unit target bounds Vitest to
two workers, including graph checks. Three simultaneous unit tasks can thus
use six workers; choose a smaller `--parallel` on constrained machines. The
original validator is unchanged; `VITEST_MAX_WORKERS=2 npm run validate` bounds
its unit workers. Desktop E2E retains its single Playwright worker.

There is no Cloud, daemon or inference. Explicit `cacheDirectory: .nx/cache`
keeps default state per worktree instead of the pinned Nx version's per-user
shared-cache relocation. Do not override it to share writable state.

Regression checks enforce the uncached policy, declared outputs and worker
bounds without depending on Nx preserving its runtime-error behavior. Acceptance
requires repeated protected tasks to execute fresh and original uncached
validation. To roll back scheduling only, restore `parallel: 1` and remove unit
env overrides; cache remains disabled and graph/install boundaries stay intact.
