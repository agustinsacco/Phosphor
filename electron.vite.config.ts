import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@phosphor/shared'] })],
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, 'libs/shared/src'),
        '@phosphor/shared': resolve(import.meta.dirname, 'libs/shared/src'),
      },
    },
    build: {
      lib: { entry: 'electron/main.ts' },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@phosphor/shared'] })],
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, 'libs/shared/src'),
        '@phosphor/shared': resolve(import.meta.dirname, 'libs/shared/src'),
      },
    },
    build: {
      lib: { entry: 'electron/preload.ts' },
      rollupOptions: {
        output: {
          // Sandboxed preload scripts must be CommonJS.
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(import.meta.dirname, 'libs/shared/src'),
        '@phosphor/shared': resolve(import.meta.dirname, 'libs/shared/src'),
        '@': resolve(import.meta.dirname, 'src'),
      },
    },
    build: {
      rollupOptions: { input: resolve(import.meta.dirname, 'src/index.html') },
    },
  },
})
