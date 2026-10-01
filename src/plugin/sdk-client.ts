import { CodeWhispererStreamingClient } from '@aws/codewhisperer-streaming-client'
import { KIRO_CONSTANTS } from '../constants.js'
import type { KiroAuthDetails, ModelRequestFields } from './types'

/**
 * Cache key includes the model request fields to ensure separate clients per
 * thinking setting, since middleware is configured at client creation time.
 */
interface ClientCacheEntry {
  client: CodeWhispererStreamingClient
  token: string
}

const clientCache = new Map<string, ClientCacheEntry>()
const KIRO_CLI_MAX_ATTEMPTS = 3

export function createSdkClient(
  auth: KiroAuthDetails,
  region: string,
  modelRequestFields?: ModelRequestFields
): CodeWhispererStreamingClient {
  const fieldsKey = modelRequestFields ? JSON.stringify(modelRequestFields) : 'none'
  const cacheKey = `${region}:${auth.email || 'default'}:${fieldsKey}`
  const cached = clientCache.get(cacheKey)

  if (cached && cached.token === auth.access) {
    return cached.client
  }

  const token = auth.access
  const client = new CodeWhispererStreamingClient({
    region,
    endpoint: `https://q.${region}.amazonaws.com`,
    token: () => Promise.resolve({ token }),
    maxAttempts: KIRO_CLI_MAX_ATTEMPTS,
    retryMode: 'standard',
    customUserAgent: [[KIRO_CONSTANTS.USER_AGENT]]
  })

  // Add Kiro-specific headers
  client.middlewareStack.add(
    (next: any) => async (args: any) => {
      args.request.headers['x-amzn-kiro-agent-mode'] = 'vibe'
      return next(args)
    },
    { step: 'build', name: 'addKiroHeaders' }
  )

  // Inject additionalModelRequestFields for thinking control
  if (modelRequestFields) {
    client.middlewareStack.add(
      (next: any) => async (args: any) => {
        // The SDK serializes input to args.input, we need to modify the body
        // before it's sent. The body is in args.request.body as a string.
        if (args.request?.body) {
          try {
            const body = JSON.parse(args.request.body)
            body.additionalModelRequestFields = modelRequestFields
            args.request.body = JSON.stringify(body)
          } catch {
            // If body parsing fails, continue without modification
          }
        }
        return next(args)
      },
      { step: 'build', name: 'addModelRequestFields', priority: 'high' }
    )
  }

  clientCache.set(cacheKey, { client, token })
  return client
}

export function clearSdkClientCache(): void {
  for (const entry of clientCache.values()) {
    entry.client.destroy()
  }
  clientCache.clear()
}
