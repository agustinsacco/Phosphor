import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(import.meta.dirname, 'libs/shared/src'),
      '@phosphor/shared': resolve(import.meta.dirname, 'libs/shared/src'),
      '@phosphor/session-runtime': resolve(import.meta.dirname, 'libs/session-runtime/src'),
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  test: {
    include: [
      'electron/**/*.test.ts',
      'libs/session-runtime/src/**/*.test.ts',
      'libs/shared/src/**/*.test.ts',
      // Bundled pi extensions: pure rule logic lives beside the extension it
      // guards, because pi loads each `-e` file standalone (no local imports).
      'libs/pi-extensions/pi-ext/**/*.test.ts',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // Release-pipeline shell helpers that CI depends on.
      'scripts/**/*.test.ts',
    ],
    // Node by default; DOM-dependent suites opt in per file with
    // `// @vitest-environment jsdom` so the fast majority stay in node.
    environment: 'node',
  },
})
