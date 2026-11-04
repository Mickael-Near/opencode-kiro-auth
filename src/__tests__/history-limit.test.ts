import { describe, expect, test } from 'bun:test'
import {
  foldHistoryToLimit,
  MAX_HISTORY_ENTRIES
} from '../infrastructure/transformers/history-limit.js'
import { transformToSdkRequest } from '../plugin/request.js'
import type { CodeWhispererMessage } from '../plugin/types'

const MODEL = 'claude-sonnet-4-5'
const ORIGIN = 'AI_EDITOR'

const auth: any = {
  access: 'access-token',
  refresh: 'refresh-token',
  expires: Date.now() + 60_000,
  authMethod: 'idc',
  region: 'us-east-1'
}

const user = (content: string, extra = {}): CodeWhispererMessage => ({
  userInputMessage: { content, modelId: MODEL, origin: ORIGIN, ...extra }
})
const assistant = (content: string, extra = {}): CodeWhispererMessage => ({
  assistantResponseMessage: { content, ...extra }
})

/** A tool loop: system turn, then one call/result pair per step. */
function toolLoop(steps: number): CodeWhispererMessage[] {
  const history = [user('SYSTEM PROMPT\n\nfix the bug')]
  for (let step = 0; step < steps; step++) {
    history.push(
      assistant(`step ${step}`, {
        toolUses: [{ toolUseId: `t${step}`, name: 'read', input: { path: `f${step}` } }]
      })
    )
    history.push(
      user('Tool results provided.', {
        userInputMessageContext: {
          toolResults: [
            { toolUseId: `t${step}`, content: [{ text: `body ${step}` }], status: 'success' }
          ]
        }
      })
    )
  }
  return history
}

function toolUseIds(history: CodeWhispererMessage[]): Set<string> {
  return new Set(
    history.flatMap(
      (entry) => entry.assistantResponseMessage?.toolUses?.map((use) => use.toolUseId) ?? []
    )
  )
}

function toolResultIds(history: CodeWhispererMessage[]): string[] {
  return history.flatMap(
    (entry) =>
      entry.userInputMessage?.userInputMessageContext?.toolResults?.map(
        (result) => result.toolUseId
      ) ?? []
  )
}

describe('foldHistoryToLimit', () => {
  test('leaves a history at the limit untouched', () => {
    const history = toolLoop(5)
    expect(foldHistoryToLimit(history, history.length)).toBe(history)
  })

  test('fits the limit and keeps user and assistant turns alternating', () => {
    const folded = foldHistoryToLimit(toolLoop(10), 8)

    expect(folded.length).toBeLessThanOrEqual(8)
    folded.forEach((entry, index) => {
      expect(!!entry.userInputMessage).toBe(index % 2 === 0)
    })
  })

  test('keeps the system prompt first and moves the folded steps into it as text', () => {
    const folded = foldHistoryToLimit(toolLoop(10), 8)
    const content = folded[0]!.userInputMessage!.content

    expect(content.startsWith('SYSTEM PROMPT\n\nfix the bug')).toBe(true)
    expect(content).toContain('Tool call read (t0): {"path":"f0"}')
    expect(content).toContain('Tool result (t0):\nbody 0')
    expect(folded[0]!.userInputMessage!.userInputMessageContext).toBeUndefined()
  })

  test('keeps the newest entries structured and as they were', () => {
    const history = toolLoop(10)
    const folded = foldHistoryToLimit(history, 8)

    expect(folded.slice(-4)).toEqual(history.slice(-4))
  })

  test('leaves no tool result without its call', () => {
    const folded = foldHistoryToLimit(toolLoop(10), 8)
    const calls = toolUseIds(folded)

    for (const id of toolResultIds(folded)) expect(calls.has(id)).toBe(true)
  })

  test('replaces folded images with a count', () => {
    const history = toolLoop(10)
    history[2]!.userInputMessage!.images = [{ format: 'png', source: { bytes: new Uint8Array() } }]

    const folded = foldHistoryToLimit(history, 8)

    expect(folded[0]!.userInputMessage!.content).toContain('[1 image(s) omitted]')
    expect(folded[0]!.userInputMessage!.images).toBeUndefined()
  })

  test('leaves a history alone when it does not open on a user turn', () => {
    const history = toolLoop(10).slice(1)
    expect(foldHistoryToLimit(history, 8)).toBe(history)
  })
})

describe('transformToSdkRequest history limit', () => {
  test('keeps a long tool session under the Kiro history limit', () => {
    const messages: any[] = [
      { role: 'system', content: 'SYSTEM PROMPT' },
      { role: 'user', content: 'fix the bug' }
    ]
    for (let step = 0; step < MAX_HISTORY_ENTRIES; step++) {
      messages.push({
        role: 'assistant',
        content: [{ type: 'tool_use', id: `t${step}`, name: 'read', input: { path: `f${step}` } }]
      })
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `t${step}`, content: `body ${step}` }]
      })
    }

    const prepared = transformToSdkRequest({ messages }, MODEL, auth)
    const history = prepared.conversationState.history!
    const currentResults =
      prepared.conversationState.currentMessage.userInputMessage!.userInputMessageContext!
        .toolResults!

    expect(history.length).toBeLessThanOrEqual(MAX_HISTORY_ENTRIES)
    expect(history[0]!.userInputMessage!.content.startsWith('SYSTEM PROMPT')).toBe(true)
    expect(currentResults.map((result) => result.toolUseId)).toEqual([
      `t${MAX_HISTORY_ENTRIES - 1}`
    ])
    expect(toolUseIds(history).has(`t${MAX_HISTORY_ENTRIES - 1}`)).toBe(true)
  })
})
