import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { version } from './package.json'

export default defineConfig({
  // The renderer's alias, so a test can draw a component (electron.vite.config.mts).
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
