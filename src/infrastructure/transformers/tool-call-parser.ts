import type { ToolCall } from '../../plugin/types'

export function parseBracketToolCalls(text: string): ToolCall[] {
  const toolCalls: ToolCall[] = []
  const pattern = /\[Called\s+(\w+)\s+with\s+args:\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})\]/gs

  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const funcName = match[1]
    const argsStr = match[2]

    if (!funcName || !argsStr) continue

    try {
      const args = JSON.parse(argsStr)
      toolCalls.push({
        toolUseId: `tool_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: funcName,
        input: args
      })
    } catch (e) {
      continue
    }
  }

  return toolCalls
}
