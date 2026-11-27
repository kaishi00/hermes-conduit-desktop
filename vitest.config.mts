import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import { version } from './package.json'

export default defineConfig({
  // The renderer's alias, so a test can draw a component (electron.vite.config.mts).
  resolve: {
    alias: [
      { find: '@shared', replacement: resolve(__dirname, 'src/shared') },
      // The strings catalog as a file read, not as a 2,7 MB module Vite has to
      // transform for every test file that draws a renderer component
      // (test/stringsCatalog.ts).
      { find: './strings.json', replacement: resolve(__dirname, 'test/stringsCatalog.ts') }
    ]
  },
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // A renderer test loads the whole renderer graph before it draws anything.
    // The default five seconds is close enough to the load a busy machine adds
    // that the renderer tests timed out in it, so they get room to finish.
    testTimeout: 15000,
    hookTimeout: 15000
  }
})
