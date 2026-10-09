# phosphor-host

The Host is Phosphor's plain-Node application for machines Desktop does not run
on. Today it is a foreground CLI that checks whether a machine can run sessions.
It starts no session and listens on nothing. Nothing builds, installs or
publishes it yet: it runs from its tests, and from a scratch bundle during
development. Desktop never runs a Host, and offline Desktop never needs one
([remote-access.md](remote-access.md)).

The source is `apps/host/src/`. It imports Node builtins and the exported
subpaths of `@phosphor/session-runtime` and `@phosphor/shared`, nothing else:
ESLint refuses Electron, `@shared/*` and `@/*`, and `boundary.test.ts` checks
every library import against the package's exports.

## Commands

```
phosphor-host doctor [--config FILE] [--json]
phosphor-host version [--json]
```

stdout carries only the report or the JSON. Usage errors go to stderr.
`version` prints `0.0.0-dev.<sha7>`, or `0.0.0-dev.source` when the build did
not stamp a commit.

| Exit          | Meaning                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| 0             | success                                                                  |
| 64            | usage error                                                              |
| 69            | a prerequisite is unavailable: node, pi, git, extensions or a repository |
| 70            | internal error                                                           |
| 78            | the config is invalid                                                    |
| 129, 130, 143 | ended by SIGHUP, SIGINT or SIGTERM, after killing any running probe      |

## Config

The file is `--config FILE`, else `${XDG_CONFIG_HOME:-~/.config}/phosphor-host/config.json`
on Linux and macOS alike. No environment variable names it.

```json
{
  "version": 1,
  "hostId": "bee1",
  "pi": {
    "node": "/home/me/.local/share/fnm/node-versions/v24.14.1/installation/bin/node",
    "executable": "/home/me/.local/share/fnm/node-versions/v24.14.1/installation/bin/pi"
  },
  "repositories": ["/home/me/src/phosphor"],
  "contextBudget": "",
  "environment": { "pass": ["GH_TOKEN"], "path": ["/home/me/.cargo/bin"] },
  "accounts": null
}
```

- **Strict.** Plain JSON up to 64 KiB with `version: 1`. Unknown keys are
  refused at any depth, and every problem is reported at once with its JSON
  pointer. A syntax error reports only its position, so a value pasted into the
  file by mistake is never echoed back.
- **Owner-only.** The config pins which programs run, so the file, its folder
  and (through a symlink) the real file's folder must belong to the user running
  the Host and must not be writable by group or others. doctor prints the
  `chmod` to run.
- **Pinned paths.** Every path is absolute and normalized. `~` is not expanded.

| Field              | Meaning                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `hostId`           | Optional. Defaults to the short hostname, made to fit the HostHello identifier pattern.                                                    |
| `pi.executable`    | What `command -v pi` prints.                                                                                                               |
| `pi.node`          | The node that runs pi. Required when `pi.executable` resolves to a Node script, as pi 0.87.1 does.                                         |
| `resourceRoot`     | Holds `pi-ext/`. Defaults to the running bundle's own folder.                                                                              |
| `repositories`     | 1 to 64 folders that sessions may run in. Never `/`.                                                                                       |
| `contextBudget`    | Desktop's grammar; `""` or absent is the 200k default. A value Desktop would quietly replace with the default, such as `77k`, is an error. |
| `environment.pass` | Up to 64 more variable names for pi. Names only, never values. Naming `PATH` or a hook below is an error.                                  |
| `environment.path` | Up to 32 more PATH folders.                                                                                                                |
| `accounts`         | `null` or absent: accounts are unavailable on a Host.                                                                                      |

## pi's environment

The Host builds pi's environment rather than passing its own, so a terminal,
`env -i` and a service manager all give pi the same variables.

| Class             | Names                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base              | `HOME USER LOGNAME SHELL LANG LANGUAGE LC_* TZ TMPDIR XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME XDG_CACHE_HOME XDG_RUNTIME_DIR`                                  |
| Provider          | The names Desktop takes from a login shell (`pi/forwarded-env.ts`): the `AWS_`, `ANTHROPIC_`, `OPENAI_`, `PI_` and other provider prefixes, and the proxy variables |
| Operator          | `environment.pass`                                                                                                                                                  |
| Ambient authority | `SSH_AUTH_SOCK SSH_AGENT_PID GPG_AGENT_INFO DISPLAY WAYLAND_DISPLAY DBUS_SESSION_BUS_ADDRESS KRB5CCNAME`: only when passed, and doctor warns                        |
| Never             | `LD_* DYLD_* NODE_OPTIONS BASH_ENV ENV PROMPT_COMMAND SHELLOPTS BASHOPTS IFS PS4`, even when passed                                                                 |

`TERM` is left out, so a Host started from a terminal behaves like one started
by a service manager.

- **PATH** is `pi.node`'s folder, then `environment.path`, then the platform
  defaults: `/usr/local/bin /usr/bin /bin /usr/local/sbin /usr/sbin /sbin`, with
  `/opt/homebrew/bin` first on macOS. The Host's own PATH never reaches pi.
- **pi's directory layout** (`PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`,
  `XDG_*`) comes only from the Host's own environment, so the Host and pi agree
  on where sessions live.
- **Secret values** are those of a credential-like name (`KEY`, `TOKEN`,
  `SECRET`, `PASSWORD`, `PASSWD`, `CREDENTIAL`, `AUTH`, `COOKIE`, `PROXY`), a provider
  variable other than `PI_*`, or any passed name, when the value has 8 or more
  characters. `PI_*` values are pi's settings and paths. Every string in a
  doctor report has each secret value replaced with `[redacted]`, overlapping
  values included, and reports list variable names, never values. PATH is
  shown as its folders.

## doctor

doctor starts no session and calls no provider: every program it runs is asked
for a version or a status. Only a failure changes the exit code. When several
fail, a config problem (78) outranks a missing prerequisite (69).

| Check                     | Rule                                                                                                                                                                                                                                                                                                                | On failure |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `host-node`               | The node running the Host is 22.19.0 or newer, as npm orders versions: a 22.19.0 prerelease is older.                                                                                                                                                                                                               | 69         |
| `config`                  | Found, owned as above, parsed and valid. doctor stops here when it is not.                                                                                                                                                                                                                                          | 78         |
| `environment`             | Warns about ambient authority, and about passed names the Host's environment does not have.                                                                                                                                                                                                                         | warning    |
| `hello`                   | The HostHello holds no secret value of pi's environment. One that would is never shown or presented; the check names the field and the variable, never the value.                                                                                                                                                   | 78         |
| `pi-node`                 | An executable file whose `--version` satisfies pi's `engines.node` as npm checks engines, prereleases included: npm comparators (`>=`, `^`, `~` and the rest) joined by spaces and `\|\|`. A range with any other part, such as `22.x`, or one that is not a string, fails. 22.19.0 or newer when pi declares none. | 69         |
| `pi`                      | A Node script needs `pi.node` (78). `--version` is 0.87.1 or newer and matches pi's own package.json when it has one.                                                                                                                                                                                               | 69         |
| `git`                     | `git --version` succeeds for the first `git` on pi's PATH.                                                                                                                                                                                                                                                          | 69         |
| `extensions`              | The six bundled extensions, and every helper they import from beside themselves, are under `<resourceRoot>/pi-ext/`.                                                                                                                                                                                                | 69         |
| `repository`              | Each root resolves to an existing folder other than `/`. A root holding the home folder, or one level under `/`, warns; one that is not a git repository is noted.                                                                                                                                                  | 69         |
| `agent-dir`               | pi's agent folder exists, meaning pi has run as this user.                                                                                                                                                                                                                                                          | warning    |
| `context-budget`          | The budget sessions will be held to.                                                                                                                                                                                                                                                                                | never      |
| `accounts`, `compression` | Unavailable on a Host: pi uses the logins of the user running it, and there is no Headroom proxy.                                                                                                                                                                                                                   | never      |

Two lanes come out of the checks:

- **native** is available when no check failed.
- **claude** needs the native lane, `@saccolabs/pi-claude-cli` 0.10.0 or newer in
  pi's global packages (the gate Desktop uses, `claudeContextProviderShortfall`),
  and a `claude` on pi's PATH that `claude auth status` reports logged in. Only
  `loggedIn` is read from that output, and a failure is described from stderr
  alone: the email and organization beside it identify a person.

`--json` adds `hello`, the HostHello this Host would present: its host id and
version, protocol 1, a `runtimeEpoch` that is new on every run, and the
capabilities `sessions.read` and `sessions.control`. It is checked with
`validateHostHello` before it is printed, and left out when it would show a
secret value (the `hello` check).

## Running other programs

Every program a check runs goes through `machine/probe.ts`:

- stdin is `/dev/null`. A program that reads stdin to EOF, as `pi -p` does,
  waits forever on a pipe nobody closes (see the `pi -p` note in
  [CLAUDE.md](../CLAUDE.md)).
- The program leads its own process group. A timeout, 10 s or 15 s for pi,
  SIGKILLs the whole group, grandchildren included.
- Output past 64 KiB is read and dropped, so the program never blocks.
- The environment is exactly pi's, as built above.
- Output comes back with every secret value of that environment hidden, before
  a check picks a line or shortens it. Where the 64 KiB cap cuts through a
  secret, the piece it kept is hidden too.

SIGHUP, SIGINT and SIGTERM kill every running probe before the Host exits,
because a terminal's Ctrl-C does not reach another process group.

## Nx and CI

The Nx project `host` has `typecheck` (`tsc --noEmit -p apps/host/tsconfig.json`)
and `test` (`vitest run apps/host`), both uncached. It depends on the runtime,
shared and pi-extensions libraries, and only `tooling` depends on it, so a
Host-only change selects `host` and `tooling` and never releases Desktop. Root
`npm run typecheck:host` runs the typecheck in the validator and in CI's checks
job; the unit tests run with every other suite in `npm test`.
