import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { isBuiltin } from 'node:module'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const library = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(library, 'package.json'), 'utf8'))

// Private source exports are build inputs, never external runtime dependencies.
// @shared/* remains the sole compatibility alias until installation closure.
describe('shared source package boundary', () => {
  it('exports the entire production source set, without tests', () => {
    const files = readdirSync(import.meta.dirname)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .sort()
    expect(manifest.name).toBe('@phosphor/shared')
    expect(manifest.private).toBe(true)
    expect(Object.keys(manifest.exports).sort()).toEqual(
      files.map((name) => `./${name.slice(0, -3)}`).sort(),
    )
    for (const file of files) {
      expect(manifest.exports[`./${file.slice(0, -3)}`]).toEqual({
        types: `./src/${file}`,
        default: `./src/${file}`,
      })
    }
  })

  it('bundles every export for browser and plain Node without application inputs', async () => {
    const entryPoints = Object.values(manifest.exports).map((entry) =>
      resolve(library, (entry as { default: string }).default),
    )
    for (const platform of ['browser', 'node'] as const) {
      const result = await build({
        absWorkingDir: root,
        entryPoints,
        bundle: true,
        platform,
        format: 'esm',
        write: false,
        outdir: 'unused',
        metafile: true,
        tsconfig: 'tsconfig.base.json',
        plugins: [
          {
            name: 'portable-shared',
            setup(builder) {
              builder.onResolve({ filter: /^(?:node:|electron(?:\/|$))/ }, ({ path }) => {
                throw new Error(`Shared source cannot import ${path}`)
              })
            },
          },
        ],
      })
      expect(
        Object.keys(result.metafile.inputs).filter((path) => /^(electron|src)\//.test(path)),
      ).toEqual([])
      expect(result.outputFiles).toHaveLength(entryPoints.length)
      for (const output of Object.values(result.metafile.outputs)) {
        expect(
          output.imports.filter(
            (entry) => entry.external && (platform === 'browser' || !isBuiltin(entry.path)),
          ),
        ).toEqual([])
      }
    }
  })
})
