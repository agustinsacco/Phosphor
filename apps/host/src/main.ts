import { constants, homedir, hostname } from 'node:os'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli } from './cli'
import { stopProbes } from './machine/probe'

// Each probe leads its own process group, so a terminal's Ctrl-C never
// reaches it. Take every probe down on the way out.
for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopProbes()
    process.exit(128 + constants.signals[signal])
  })
}

process.exitCode = await runCli(
  process.argv.slice(2),
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
  },
  {
    env: process.env,
    platform: process.platform,
    uid: process.getuid?.(),
    home: homedir(),
    hostname: hostname(),
    nodeVersion: process.versions.node,
    // The bundle's own folder, which holds pi-ext/ beside it.
    defaultResourceRoot: dirname(fileURLToPath(import.meta.url)),
  },
)
