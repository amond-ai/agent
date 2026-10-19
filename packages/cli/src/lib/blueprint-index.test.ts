import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildBlueprintIndex } from './blueprint-index.ts'

const daytona = readFileSync(
  fileURLToPath(new URL('../../../../blueprints/sandbox--daytona.md', import.meta.url)),
  'utf-8',
)

describe('buildBlueprintIndex', () => {
  it('derives the slug from the filename', () => {
    const index = buildBlueprintIndex([{ file: 'sandbox--daytona.md', source: daytona }])
    expect(index.blueprints.map(blueprint => blueprint.slug)).toEqual(['daytona'])
  })

  it.each(['sandbox--.md', 'sandbox--Daytona.md', 'sandbox--day tona.md', 'sandbox--day#tona.md', 'sandbox---daytona.md'])(
    'rejects the filename %s',
    (file) => {
      expect(() => buildBlueprintIndex([{ file, source: daytona }])).toThrow(/blueprint name .* must be lowercase/)
    },
  )
})
