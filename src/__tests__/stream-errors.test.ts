import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { describe, expect, test } from 'bun:test'
import { transformSdkStream } from '../plugin/streaming/sdk-stream-transformer.js'

const MODEL = 'claude-opus-5.5'

function streamOf(events: any[]) {
  return {
    generateAssistantResponseResponse: (async function* () {
      for (const event of events) yield event
    })()
  }
}

function transform(events: any[]) {
  return transformSdkStream(streamOf(events), MODEL, 'conversation-1')
}

async function collect(events: any[]) {
  const chunks: any[] = []
  for await (const chunk of transform(events)) {
    chunks.push(chunk)
  }

  let reasoning = ''
  let text = ''
  let finish: string | null = null
  let error: any = null
  for (const chunk of chunks) {
    const delta = chunk.choices?.[0]?.delta
    if (delta?.reasoning_content) reasoning += delta.reasoning_content
    if (delta?.content) text += delta.content
    const reason = chunk.choices?.[0]?.finish_reason
    if (reason) finish = reason
    if (chunk.error) error = chunk.error
  }

  return { chunks, reasoning, text, finish, error }
}

describe('sdk stream error reporting', () => {
  // The service reports failures such as MODEL_TEMPORARILY_UNAVAILABLE as an
  // in-band `error` event. It used to be dropped, so the truncated turn was
  // stored as a successful end_turn with no content.
  test('surfaces an in-band error event as an error chunk', async () => {
    const { reasoning, finish, error } = await collect([
      { reasoningContentEvent: { text: 'thinking' } },
      { error: { message: 'MODEL_TEMPORARILY_UNAVAILABLE' } }
    ])

    expect(reasoning).toBe('thinking')
    expect(finish).toBeNull()
    expect(error?.message).toContain('MODEL_TEMPORARILY_UNAVAILABLE')
    expect(error?.code).toBe('kiro_stream_error')
  })

  test('surfaces an invalid state event as an error chunk', async () => {
    const { finish, error } = await collect([
      { invalidStateEvent: { reason: 'SOMETHING_ODD', message: 'The stream went invalid' } }
    ])

    expect(finish).toBeNull()
    expect(error?.message).toContain('The stream went invalid')
  })

  // Live shape of the Opus 5.5 cutoff: reasoning streams for minutes, then the
  // connection is severed and the SDK reports a clean end of stream. That must
  // not become an end_turn without answer or tool call.
  test('reports a stream that ends after reasoning with no answer', async () => {
    const { reasoning, text, finish, error } = await collect([
      { reasoningContentEvent: { text: 'very long reasoning' } }
    ])

    expect(reasoning).toBe('very long reasoning')
    expect(text).toBe('')
    expect(finish).toBeNull()
    expect(error?.message).toContain('ended after')
    expect(error?.message).toContain('cut off')
    expect(error?.code).toBe('kiro_stream_truncated')
  })

  test('does not flag reasoning followed by an answer', async () => {
    const { text, finish, error } = await collect([
      { reasoningContentEvent: { text: 'thinking' } },
      { assistantResponseEvent: { content: 'Answer.' } }
    ])

    expect(text).toBe('Answer.')
    expect(finish).toBe('stop')
    expect(error).toBeNull()
  })

  test('does not flag reasoning followed by a tool call', async () => {
    const { finish, error } = await collect([
      { reasoningContentEvent: { text: 'thinking' } },
      {
        toolUseEvent: { name: 'shell', toolUseId: 'tool-use-1', input: '{"cmd":"ls"}', stop: true }
      }
    ])

    expect(finish).toBe('tool_calls')
    expect(error).toBeNull()
  })

  test('does not flag an ordinary text-only response', async () => {
    const { text, finish, error } = await collect([
      { assistantResponseEvent: { content: 'Plain answer.' } }
    ])

    expect(text).toBe('Plain answer.')
    expect(finish).toBe('stop')
    expect(error).toBeNull()
  })

  // Locks the error chunk shape to what the SDK actually parses: the plugin's
  // own chunks are fed through @ai-sdk/openai-compatible and must come out as a
  // provider error part carrying the message, which OpenCode then records.
  test('the error chunk is read by @ai-sdk/openai-compatible as a provider error', async () => {
    const pluginChunks: any[] = []
    for await (const chunk of transform([{ reasoningContentEvent: { text: 'thinking' } }])) {
      pluginChunks.push(chunk)
    }

    const sse = pluginChunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')
    const provider = createOpenAICompatible({
      name: 'kiro',
      baseURL: 'https://example.invalid/v1',
      apiKey: '',
      fetch: (async () =>
        new Response(sse, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' }
        })) as unknown as typeof fetch
    })

    const model = provider.chatModel(MODEL) as any
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]
    })

    const parts: any[] = []
    for await (const part of stream) parts.push(part)

    const errorParts = parts.filter((part) => part.type === 'error')
    expect(errorParts).toHaveLength(1)
    expect(errorParts[0].error.message).toContain('cut off')
    expect(errorParts[0].error.code).toBe('kiro_stream_truncated')
  })
})
