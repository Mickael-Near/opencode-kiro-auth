import { Buffer } from 'node:buffer'
import type { CodeWhispererMessage, CodeWhispererRequest } from './types'

/** Encodes binary fields the way the SDK puts them on the wire: as base64 strings. */
export const binaryToBase64Replacer = (_key: string, value: unknown): unknown => {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64')
  return value
}

/**
 * Size breakdown of a conversation sent to Kiro, in UTF-8 bytes of its JSON
 * encoding. Logged when Kiro rejects an input as too long, to tell a token
 * ceiling apart from a payload-size one.
 */
export interface PayloadStats {
  bytes: number
  historyEntries: number
  largestEntryBytes: number
  toolResultBytes: number
  toolSpecBytes: number
  images: number
}

function jsonBytes(value: unknown): number {
  if (value === undefined) return 0
  return Buffer.byteLength(JSON.stringify(value, binaryToBase64Replacer), 'utf8')
}

export function measurePayload(
  conversationState: Partial<CodeWhispererRequest['conversationState']>
): PayloadStats {
  const history = conversationState.history ?? []
  const entries: CodeWhispererMessage[] = conversationState.currentMessage
    ? [...history, conversationState.currentMessage]
    : history

  const stats: PayloadStats = {
    bytes: jsonBytes(conversationState),
    historyEntries: history.length,
    largestEntryBytes: 0,
    toolResultBytes: 0,
    toolSpecBytes: 0,
    images: 0
  }

  for (const entry of entries) {
    const context = entry.userInputMessage?.userInputMessageContext
    stats.largestEntryBytes = Math.max(stats.largestEntryBytes, jsonBytes(entry))
    stats.toolResultBytes += jsonBytes(context?.toolResults)
    stats.toolSpecBytes += jsonBytes(context?.tools)
    stats.images += entry.userInputMessage?.images?.length ?? 0
  }

  return stats
}
