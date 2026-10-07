// Playwright puts its debugging flags before custom args, unlike its default
// loader path. Remove only this preload's exact argv pair before delegating
// to the installed loader, which consumes the standard debugging flags.
const index = process.argv.indexOf(__filename)
if (index !== -1) {
  if (
    index === 0 ||
    process.argv[index - 1] !== '-r' ||
    process.argv.lastIndexOf(__filename) !== index
  ) {
    throw new Error('Unexpected Desktop Electron preload argv layout')
  }
  process.argv.splice(index - 1, 2)
}

const { dirname, join } = require('node:path')
const loader = join(
  dirname(require.resolve('playwright-core/package.json')),
  'lib/server/electron/loader.js',
)
require(loader)
