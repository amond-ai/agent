import { defineConfig } from 'vitest/config'
import { sharedCoverage, sharedInlineDeps } from '../../vitest.shared'

export default defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    server: { deps: { inline: sharedInlineDeps } },
    coverage: { ...sharedCoverage, include: ['src/**'] },
  },
})
