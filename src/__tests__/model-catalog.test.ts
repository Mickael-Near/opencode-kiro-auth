import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  activateCatalog,
  FALLBACK_CATALOG,
  getCatalog,
  getCatalogModel,
  loadCatalog
} from '../plugin/model-catalog.js'
import type { KiroAuthDetails } from '../plugin/types.js'

function makeAuth(overrides: Partial<KiroAuthDetails> = {}): KiroAuthDetails {
  return {
    refresh: 'refresh-token',
    access: 'access-token',
    expires: Date.now() + 3600000,
    authMethod: 'idc',
    region: 'us-east-1',
    profileArn: 'arn:aws:codewhisperer:eu-central-1:000000:profile/ABC',
    ...overrides
  }
}

function availableModel(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 'claude-opus-5.5',
    modelName: 'Claude Opus 5.5',
    rateMultiplier: 2.0,
    supportedInputTypes: ['TEXT', 'IMAGE'],
    tokenLimits: { maxInputTokens: 1000000, maxOutputTokens: 128000 },
    additionalModelRequestFieldsSchema: {
      properties: {
        thinking: { properties: { type: { enum: ['adaptive'] } } },
        output_config: {
          properties: { effort: { enum: ['low', 'medium', 'high', 'xhigh', 'max'] } }
        }
      }
    },
    ...overrides
  }
}

/** Run `fn` with a stubbed global fetch, returning the calls it received. */
async function withFetch(
  handler: (url: string, init: RequestInit) => Response,
  fn: () => Promise<void>
): Promise<Array<{ url: string; init: RequestInit }>> {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const original = globalThis.fetch
  globalThis.fetch = mock(async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }) as any
  try {
    await fn()
  } finally {
    globalThis.fetch = original
  }
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

afterEach(() => activateCatalog(FALLBACK_CATALOG))

describe('fallback catalog', () => {
  test('is the catalog before any load', () => {
    expect(getCatalog()).toBe(FALLBACK_CATALOG)
    expect(getCatalogModel('claude-opus-5')?.name).toBe('Claude Opus 5')
  })

  test('declares effort levels only on models Kiro gives a thinking schema', () => {
    expect(getCatalogModel('claude-opus-5')?.effortLevels).toContain('xhigh')
    expect(getCatalogModel('claude-opus-4.6')?.effortLevels).not.toContain('xhigh')
    expect(getCatalogModel('claude-sonnet-4.5')?.effortLevels).toEqual([])
    expect(getCatalogModel('claude-haiku-4.5')?.effortLevels).toEqual([])
  })

  // Mirrors each model's `thinking.type` enum in the ListAvailableModels snapshot.
  test('records the thinking types each model declares', () => {
    expect(getCatalogModel('claude-opus-5.5')?.thinkingTypes).toEqual(['adaptive'])
    expect(getCatalogModel('claude-opus-5')?.thinkingTypes).toEqual(['adaptive', 'disabled'])
    expect(getCatalogModel('claude-sonnet-4.6')?.thinkingTypes).toEqual(['adaptive', 'disabled'])
    expect(getCatalogModel('claude-haiku-4.5')?.thinkingTypes).toEqual([])
  })
})

describe('loadCatalog', () => {
  test('replaces the catalog with what Kiro reports', async () => {
    await withFetch(
      () => jsonResponse({ models: [availableModel(), availableModel({ modelId: 'glm-5' })] }),
      () => loadCatalog(async () => makeAuth())
    )

    expect(getCatalog().map((model) => model.id)).toEqual(['claude-opus-5.5', 'glm-5'])
  })

  test('maps Kiro metadata onto the catalog shape', async () => {
    await withFetch(
      () => jsonResponse({ models: [availableModel()] }),
      () => loadCatalog(async () => makeAuth())
    )

    expect(getCatalogModel('claude-opus-5.5')).toEqual({
      id: 'claude-opus-5.5',
      name: 'Claude Opus 5.5',
      rate: 2.0,
      limit: { context: 1000000, output: 128000 },
      input: ['text', 'image'],
      effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      thinkingTypes: ['adaptive']
    })
  })

  test('reads which thinking types the model accepts', async () => {
    await withFetch(
      () =>
        jsonResponse({
          models: [
            availableModel({
              modelId: 'claude-sonnet-4.6',
              additionalModelRequestFieldsSchema: {
                properties: {
                  thinking: { properties: { type: { enum: ['disabled', 'adaptive', 'eager'] } } }
                }
              }
            })
          ]
        }),
      () => loadCatalog(async () => makeAuth())
    )

    expect(getCatalogModel('claude-sonnet-4.6')?.thinkingTypes).toEqual(['adaptive', 'disabled'])
  })

  // Kiro rejects this endpoint with 403 "Your subscription does not support this
  // application" unless the request looks like it comes from the IDE.
  test('identifies itself as the Kiro IDE and targets the profile region', async () => {
    const calls = await withFetch(
      () => jsonResponse({ models: [availableModel()] }),
      () => loadCatalog(async () => makeAuth())
    )

    const [call] = calls
    expect(call?.url).toContain('https://q.eu-central-1.amazonaws.com/ListAvailableModels')
    expect(call?.url).toContain('origin=AI_EDITOR')
    expect(call?.url).toContain('profileArn=arn')
    expect((call?.init.headers as Record<string, string>)['user-agent']).toBe('KiroIDE')
  })

  test('omits profileArn for accounts without one', async () => {
    const calls = await withFetch(
      () => jsonResponse({ models: [availableModel()] }),
      () => loadCatalog(async () => makeAuth({ profileArn: undefined }))
    )

    expect(calls[0]?.url).toContain('https://q.us-east-1.amazonaws.com/')
    expect(calls[0]?.url).not.toContain('profileArn')
  })

  describe('defaults for partial payloads', () => {
    test('drops entries without a model ID', async () => {
      await withFetch(
        () => jsonResponse({ models: [{ modelName: 'Nameless' }, availableModel()] }),
        () => loadCatalog(async () => makeAuth())
      )

      expect(getCatalog().map((model) => model.id)).toEqual(['claude-opus-5.5'])
    })

    test('fills in name, rate, limits and modalities', async () => {
      await withFetch(
        () =>
          jsonResponse({
            models: [
              {
                modelId: 'mystery-model',
                additionalModelRequestFieldsSchema: null
              }
            ]
          }),
        () => loadCatalog(async () => makeAuth())
      )

      expect(getCatalogModel('mystery-model')).toEqual({
        id: 'mystery-model',
        name: 'mystery-model',
        rate: 1,
        limit: { context: 200000, output: 64000 },
        input: ['text'],
        effortLevels: [],
        thinkingTypes: []
      })
    })

    test('ignores effort levels the plugin does not know', async () => {
      await withFetch(
        () =>
          jsonResponse({
            models: [
              availableModel({
                additionalModelRequestFieldsSchema: {
                  properties: {
                    output_config: { properties: { effort: { enum: ['medium', 'ultra', 'max'] } } }
                  }
                }
              })
            ]
          }),
        () => loadCatalog(async () => makeAuth())
      )

      expect(getCatalogModel('claude-opus-5.5')?.effortLevels).toEqual(['medium', 'max'])
    })

    test('orders effort levels low to max whatever the payload order', async () => {
      await withFetch(
        () =>
          jsonResponse({
            models: [
              availableModel({
                additionalModelRequestFieldsSchema: {
                  properties: {
                    output_config: { properties: { effort: { enum: ['max', 'low', 'high'] } } }
                  }
                }
              })
            ]
          }),
        () => loadCatalog(async () => makeAuth())
      )

      expect(getCatalogModel('claude-opus-5.5')?.effortLevels).toEqual(['low', 'high', 'max'])
    })
  })

  // Model discovery must never stop the provider from registering.
  describe('keeps the fallback catalog on failure', () => {
    test('on a non-2xx response', async () => {
      await withFetch(
        () => new Response('{"message":"subscription does not support"}', { status: 403 }),
        () => loadCatalog(async () => makeAuth())
      )

      expect(getCatalog()).toBe(FALLBACK_CATALOG)
    })

    test('on an empty model list', async () => {
      await withFetch(
        () => jsonResponse({ models: [] }),
        () => loadCatalog(async () => makeAuth())
      )

      expect(getCatalog()).toBe(FALLBACK_CATALOG)
    })

    test('on a malformed body', async () => {
      await withFetch(
        () => new Response('not json', { status: 200 }),
        () => loadCatalog(async () => makeAuth())
      )

      expect(getCatalog()).toBe(FALLBACK_CATALOG)
    })

    test('when no account can be resolved', async () => {
      const calls = await withFetch(
        () => jsonResponse({ models: [availableModel()] }),
        () =>
          loadCatalog(async () => {
            throw new Error('No healthy Kiro account available')
          })
      )

      expect(calls).toHaveLength(0)
      expect(getCatalog()).toBe(FALLBACK_CATALOG)
    })
  })
})
