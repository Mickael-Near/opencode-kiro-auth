import { describe, expect, test } from 'bun:test'
import { measurePayload } from '../plugin/payload-stats.js'

const toolResults = [{ toolUseId: 't1', content: [{ text: 'é'.repeat(10) }], status: 'success' }]
const tools = [
  {
    toolSpecification: {
      name: 'read',
      description: 'Read a file',
      inputSchema: { json: { type: 'object' } }
    }
  }
]

const conversationState = {
  chatTriggerType: 'MANUAL',
  conversationId: 'conversation-1',
  history: [
    { userInputMessage: { content: 'hi', modelId: 'm', origin: 'o' } },
    { assistantResponseMessage: { content: 'a'.repeat(500) } }
  ],
  currentMessage: {
    userInputMessage: {
      content: 'next',
      modelId: 'm',
      origin: 'o',
      images: [{ format: 'png', source: { bytes: new Uint8Array([1, 2, 3]) } }],
      userInputMessageContext: { toolResults, tools }
    }
  }
}

describe('measurePayload', () => {
  test('counts UTF-8 bytes of the wire encoding, with images as base64', () => {
    const wire = JSON.stringify({
      ...conversationState,
      currentMessage: {
        userInputMessage: {
          ...conversationState.currentMessage.userInputMessage,
          images: [{ format: 'png', source: { bytes: 'AQID' } }]
        }
      }
    })

    expect(measurePayload(conversationState).bytes).toBe(Buffer.byteLength(wire, 'utf8'))
  })

  test('breaks the payload down by history, tool results, tool specs and images', () => {
    const stats = measurePayload(conversationState)

    expect(stats.historyEntries).toBe(2)
    expect(stats.largestEntryBytes).toBe(JSON.stringify(conversationState.history[1]).length)
    expect(stats.toolResultBytes).toBe(Buffer.byteLength(JSON.stringify(toolResults), 'utf8'))
    expect(stats.toolSpecBytes).toBe(JSON.stringify(tools).length)
    expect(stats.images).toBe(1)
  })

  test('handles an empty conversation state', () => {
    expect(measurePayload({})).toEqual({
      bytes: 2,
      historyEntries: 0,
      largestEntryBytes: 0,
      toolResultBytes: 0,
      toolSpecBytes: 0,
      images: 0
    })
  })
})
