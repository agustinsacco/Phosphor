import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('bundles every session runtime entry for plain Node without Desktop imports', async () => {
  const entryPoints = (await readdir(import.meta.dirname))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(import.meta.dirname, name))
  const result = await build({
    entryPoints,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    outdir: 'unused',
    metafile: true,
    tsconfig: 'tsconfig.node.json',
    plugins: [
      {
        name: 'no-electron',
        setup(builder) {
          builder.onResolve({ filter: /^electron(?:\/|$)/ }, () => {
            throw new Error('Session runtime must not import Electron')
          })
        },
      },
    ],
  })
  expect(
    Object.keys(result.metafile.inputs).filter((path) => /(^|\/)electron\//.test(path)),
  ).toEqual([])
  expect(result.outputFiles).toHaveLength(entryPoints.length)
})
