import type { ToolDefinition } from './tool-types.ts'

interface PreparedToolAdapter {
  readonly parameters: object
  execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<string>
}

const preparedToolAdapter = Symbol('amond.preparedToolAdapter')

type PreparedToolDefinition = ToolDefinition & {
  readonly [preparedToolAdapter]?: PreparedToolAdapter
}

export function registerPreparedToolAdapter(
  tool: ToolDefinition,
  adapter: PreparedToolAdapter,
): void {
  Object.defineProperty(tool, preparedToolAdapter, {
    value: Object.freeze(adapter),
    enumerable: true,
  })
}

export function getPreparedToolAdapter(tool: ToolDefinition): PreparedToolAdapter | undefined {
  return (tool as PreparedToolDefinition)[preparedToolAdapter]
}
