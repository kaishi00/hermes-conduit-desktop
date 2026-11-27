/**
 * The strings catalog, read as a file.
 *
 * Vite's JSON plugin turns `src/shared/strings.json` (2,7 MB, 3237 keys in
 * thirteen languages) into a JavaScript module, and every test file that
 * draws a renderer component pays that transform again — about a second per
 * file, which is what pushed the renderer tests past vitest's five second
 * default and made them time out when the machine was busy.
 *
 * Reading the file and parsing it costs 37 ms instead of 1,1 s, and it is the
 * same data. The test config points i18n's import here; `test/strings.test.ts`
 * imports the catalog as it is and checks every language in it.
 *
 * The path is looked up from the test run's root rather than from
 * `import.meta.url`: that URL's scheme depends on who imported this module,
 * and a `file://` path is not always what it is.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** The catalog's file: the first `src/shared/strings.json` above the run's root. */
function catalogPath(): string {
  let dir = process.cwd()
  for (;;) {
    const candidate = join(dir, 'src', 'shared', 'strings.json')
    if (existsSync(candidate)) return candidate
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`The strings catalog is not above ${process.cwd()}.`)
}

export default JSON.parse(readFileSync(catalogPath(), 'utf8')) as Record<string, Record<string, string>>
