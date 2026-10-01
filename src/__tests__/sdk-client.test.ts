import { GenerateAssistantResponseCommand } from '@aws/codewhisperer-streaming-client'
import { describe, expect, test } from 'bun:test'
import { clearSdkClientCache, createSdkClient } from '../plugin/sdk-client'
import type { Effort, KiroAuthDetails, ModelRequestFields } from '../plugin/types'

function adaptive(effort: Effort): ModelRequestFields {
  return { thinking: { type: 'adaptive' }, output_config: { effort } }
}

function auth(): KiroAuthDetails {
  return {
    refresh: 'refresh-token',
    access: 'access-token',
    expires: Date.now() + 3600000,
    authMethod: 'idc',
    region: 'us-east-1',
    email: 'user@example.com'
  }
}

async function captureRequest(client: ReturnType<typeof createSdkClient>) {
  let capturedRequest: any

  client.middlewareStack.add(
    () => async (args: any) => {
      capturedRequest = args.request
      throw new Error('captured-request')
    },
    { step: 'finalizeRequest', name: 'captureRequest', priority: 'high' }
  )

  const command = new GenerateAssistantResponseCommand({
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: 'test-conversation',
      currentMessage: {
        userInputMessage: {
          content: 'hello',
          modelId: 'claude-opus-4.7',
          origin: 'AI_EDITOR'
        }
      }
    }
  })

  await client.send(command).catch((error) => {
    if (error.message !== 'captured-request') throw error
  })

  const bodyText =
    typeof capturedRequest.body === 'string'
      ? capturedRequest.body
      : Buffer.from(capturedRequest.body).toString('utf8')

  return {
    body: JSON.parse(bodyText),
    request: { headers: capturedRequest.headers, bodyText }
  }
}

describe('SDK client', () => {
  test('uses Kiro CLI-style standard SDK retries for throttling', async () => {
    clearSdkClientCache()

    const client = createSdkClient(auth(), 'us-east-1')

    expect(await client.config.maxAttempts()).toBe(3)
    const retryMode = client.config.retryMode
    expect(typeof retryMode === 'function' ? await retryMode() : retryMode).toBe('standard')

    clearSdkClientCache()
  })

  test('injects model request fields before content-length is computed', async () => {
    clearSdkClientCache()

    const fields = adaptive('max')
    const client = createSdkClient(auth(), 'us-east-1', fields)
    const { body, request } = await captureRequest(client)

    expect(body.additionalModelRequestFields).toEqual(fields)
    expect(Number(request.headers['content-length'])).toBe(Buffer.byteLength(request.bodyText))

    clearSdkClientCache()
  })

  test('omits additionalModelRequestFields when none are set', async () => {
    clearSdkClientCache()

    const client = createSdkClient(auth(), 'us-east-1')
    const { body } = await captureRequest(client)

    expect(body.additionalModelRequestFields).toBeUndefined()

    clearSdkClientCache()
  })

  test('injects thinking disabled without an effort', async () => {
    clearSdkClientCache()

    const client = createSdkClient(auth(), 'us-east-1', { thinking: { type: 'disabled' } })
    const { body } = await captureRequest(client)

    expect(body.additionalModelRequestFields).toEqual({ thinking: { type: 'disabled' } })

    clearSdkClientCache()
  })

  test('does not reuse a cached client across different request fields', () => {
    clearSdkClientCache()

    const max = createSdkClient(auth(), 'us-east-1', adaptive('max'))
    const xhigh = createSdkClient(auth(), 'us-east-1', adaptive('xhigh'))
    const off = createSdkClient(auth(), 'us-east-1', { thinking: { type: 'disabled' } })
    const maxAgain = createSdkClient(auth(), 'us-east-1', adaptive('max'))

    expect(xhigh).not.toBe(max)
    expect(off).not.toBe(max)
    expect(maxAgain).toBe(max)

    clearSdkClientCache()
  })
})
