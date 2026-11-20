import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // The renderer's alias, so a test can draw a component (electron.vite.config.mts).
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
