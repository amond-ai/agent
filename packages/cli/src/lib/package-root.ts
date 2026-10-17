import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Locate the amond package root by walking up from this module.
 *
 * A fixed relative hop (`../package.json`) cannot work here: in development
 * this file sits at `src/lib/` (two levels below the package root), but the
 * built CLI bundles it into `dist/amond.js` (one level below). Walking up to
 * the package.json that names `amond` is correct in both contexts.
 */

let cachedRoot: string | undefined

export function cliPackageRoot(): string {
  if (cachedRoot !== undefined) { return cachedRoot }
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (true) {
    const pkgPath = path.join(dir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { name?: string }
        if (pkg.name === 'amond') {
          cachedRoot = dir
          return dir
        }
      }
      catch {
        // Unreadable package.json (unrelated tool artifact) — keep walking.
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error('[amond] Internal error: could not locate the amond package root.')
    }
    dir = parent
  }
}

export function readCliVersion(): string {
  const pkg = JSON.parse(fs.readFileSync(path.join(cliPackageRoot(), 'package.json'), 'utf8')) as {
    version: string
  }
  return pkg.version
}
