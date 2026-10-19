import { defineConfig } from 'vitest/config'
import { sharedCoverage } from '../../vitest.shared'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: { ...sharedCoverage, include: ['src/**'] },
  },
})
