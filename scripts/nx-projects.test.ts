import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const projects = {
  desktop: '.',
  runtime: 'runtime',
  shared: 'shared',
  'pi-extensions': 'pi-ext',
  site: 'site',
  schema: 'supabase',
  tooling: 'scripts',
}
const commands = {
  desktop: { build: 'electron-vite build', 'test:e2e': 'npm run build && ./scripts/e2e.sh' },
  runtime: { test: 'vitest run runtime' },
  shared: { test: 'vitest run shared' },
  'pi-extensions': { test: 'vitest run pi-ext' },
  site: {
    dev: 'npm run dev',
    start: 'npm run start',
    prebuild: 'npm run prebuild',
    build: 'npm run build',
    check: 'npm run check',
    preview: 'npm run preview',
    shots: 'npm run shots',
    'shots:guides': 'npm run shots:guides',
    'audit:links': 'npm run audit:links',
    test: 'npm test',
    format: 'npm run format',
  },
  schema: {
    start: 'npx --yes supabase@2.119.0 start',
    stop: 'npx --yes supabase@2.119.0 stop --no-backup',
    test: 'npx --yes supabase@2.119.0 test db',
  },
  tooling: {
    typecheck: 'tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json',
    lint: 'eslint .',
    test: 'vitest run',
    validate: './scripts/validate.sh',
    'format-check': 'prettier --check .',
    'test:graph': 'vitest run scripts/nx-projects.test.ts',
  },
}
// These edges include non-import resources and test-only consumers, not just
// production imports. Cyclic project ownership must not become recursive tasks.
const dependencies = {
  desktop: ['runtime', 'shared', 'pi-extensions', 'tooling'],
  runtime: ['shared', 'pi-extensions'],
  shared: [],
  'pi-extensions': ['desktop'],
  site: ['desktop', 'tooling'],
  schema: [],
  tooling: ['desktop', 'runtime', 'shared', 'pi-extensions', 'site', 'schema'],
}
const assertEdges = (name: keyof typeof dependencies, edges: string[]) =>
  expect([...edges].sort()).toEqual([...dependencies[name]].sort())
const assertTargets = (name: keyof typeof commands, targets: Record<string, unknown>) =>
  expect(Object.keys(targets).sort()).toEqual(Object.keys(commands[name]).sort())
const nx = (...args: string[]) =>
  execFileSync(process.execPath, [join(root, 'node_modules/nx/dist/bin/nx.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true' },
  })

function readGraph() {
  const dir = mkdtempSync(join(tmpdir(), 'phosphor-nx-graph-'))
  try {
    nx('graph', `--file=${join(dir, 'graph.json')}`)
    return JSON.parse(readFileSync(join(dir, 'graph.json'), 'utf8')).graph
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('explicit Nx project contract', () => {
  // One graph process returns effective targets too. Spawning a process for
  // every project makes this suite CPU-bound during the full unit run.
  let graph: ReturnType<typeof readGraph>
  beforeAll(() => {
    graph = readGraph()
  })
  it('exercises the security overrides through Nx dependency resolution without network access', async () => {
    const require = createRequire(import.meta.url)
    const nxRequire = createRequire(require.resolve('nx/package.json'))
    expect(readJson('package.json').overrides).toEqual({
      'nx@23.2.1': { axios: '1.20.0', 'brace-expansion': '5.0.12', 'smol-toml': '1.9.0' },
    })
    const axios = nxRequire('axios')
    expect(axios.VERSION).toBe('1.20.0')
    expect(axios.getUri({ url: '/graph', params: { project: 'desktop' } })).toBe(
      '/graph?project=desktop',
    )
    const response = await axios.get('/graph', {
      adapter: async () => ({
        data: 'local',
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      }),
    })
    expect(response.data).toBe('local')
    expect(nxRequire('brace-expansion').expand('{runtime,shared}/**/*.test.ts')).toEqual([
      'runtime/**/*.test.ts',
      'shared/**/*.test.ts',
    ])
    const toml = nxRequire('smol-toml')
    const parsed = toml.parse('[project]\nname = "runtime"\n')
    expect(parsed).toEqual({ project: { name: 'runtime' } })
    expect(toml.parse(toml.stringify(parsed))).toEqual(parsed)
  })
  it('retains exactly seven current-path projects and all import/resource/test edges', () => {
    expect(Object.keys(graph.nodes).sort()).toEqual(Object.keys(projects).sort())
    for (const [name, path] of Object.entries(projects)) {
      expect(graph.nodes[name].data.root).toBe(path)
      const edges = graph.dependencies[name].map((edge: { target: string }) => edge.target)
      assertEdges(name as keyof typeof dependencies, edges)
    }
  })

  it('keeps effective targets uncached, nonrecursive and equivalent to underlying commands', () => {
    for (const [name, expected] of Object.entries(commands)) {
      const project = graph.nodes[name].data
      assertTargets(name as keyof typeof commands, project.targets)
      for (const [target, command] of Object.entries(expected)) {
        expect(project.targets[target]).toMatchObject({
          executor: 'nx:run-commands',
          cache: false,
          inputs: ['workspace'],
          options: { command, cwd: name === 'site' ? 'site' : '.' },
        })
        expect(project.targets[target].dependsOn ?? []).toEqual([])
      }
    }
  })

  it('rejects missing edge fixtures, including the real extension test back-edge', () => {
    for (const [name, edges] of Object.entries(dependencies)) {
      const config = readJson(join(projects[name as keyof typeof projects], 'project.json'))
      for (const edge of edges) {
        const removed = config.implicitDependencies.filter((value: string) => value !== edge)
        expect(removed).not.toContain(edge)
        expect(config.implicitDependencies).toContain(edge)
        expect(() => assertEdges(name as keyof typeof dependencies, removed)).toThrow()
      }
    }
    expect(readFileSync(join(root, 'pi-ext/optional/permission-gate.test.ts'), 'utf8')).toContain(
      '../../src/features/extension-ui/commandApproval',
    )
    expect(readFileSync(join(root, 'electron-builder.yml'), 'utf8')).toContain('from: pi-ext')
    expect(readFileSync(join(root, 'runtime/bundled-extensions.test.ts'), 'utf8')).toContain(
      "join(root, 'pi-ext')",
    )
  })

  it('rejects missing required target fixtures and Nx alias recursion', () => {
    for (const [name, targets] of Object.entries(commands)) {
      const config = readJson(join(projects[name as keyof typeof projects], 'project.json'))
      for (const target of Object.keys(targets)) {
        const removed = { ...config.targets }
        delete removed[target]
        expect(() => assertTargets(name as keyof typeof commands, removed)).toThrow()
      }
    }
    const pkg = readJson('package.json')
    expect(pkg.nx.includedScripts).toEqual([])
    for (const target of Object.values(commands).flatMap((targets) => Object.values(targets))) {
      expect(target).not.toMatch(/npm run nx:|\bnx (run|run-many|affected)\b/)
    }
    expect(pkg.scripts.postinstall).toBe(
      'electron-builder install-app-deps && node scripts/fix-node-pty.mjs',
    )
  })

  it('uses workspaceRoot inputs to include nested projects in the unchanged full unit runner', () => {
    const config = readJson('nx.json')
    expect(config.namedInputs.workspace).toContain('{workspaceRoot}/**/*')
    expect(config.neverConnectToCloud).toBe(true)
    expect(config.plugins).toEqual([])
    expect(config.parallel).toBe(1)
    expect(config.targetDefaults['nx:run-commands'].cache).toBe(false)
    const vitest = readFileSync(join(root, 'vitest.config.ts'), 'utf8')
    for (const path of ['electron', 'runtime', 'shared', 'pi-ext', 'src', 'scripts']) {
      expect(vitest).toContain(`'${path}/**/*.test.ts'`)
    }
    expect(vitest).toContain("'src/**/*.test.tsx'")
    expect(readJson('scripts/project.json').targets.test.options.command).toBe(
      readJson('package.json').scripts.test,
    )
  })
})
