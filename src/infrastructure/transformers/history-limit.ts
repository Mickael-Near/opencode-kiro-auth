import type { CodeWhispererMessage } from '../../plugin/types'

type UserInput = NonNullable<CodeWhispererMessage['userInputMessage']>
type ToolResult = NonNullable<
  NonNullable<UserInput['userInputMessageContext']>['toolResults']
>[number]

/**
 * Most history entries Kiro accepts in one request. Probed on claude-opus-5.5
 * in November 2026: 198 entries pass and 200 fail with "Input is too long",
 * whatever the token count and with or without tool use.
 */
export const MAX_HISTORY_ENTRIES = 198

/** The folded prefix becomes one user turn and its reply. */
const FOLDED_ENTRY_COUNT = 2

const FOLDED_HEADER = '[Earlier conversation, flattened to text to fit the provider history limit]'
const FOLDED_REPLY = '[system: conversation continues]'

/**
 * Keeps a history under Kiro's entry limit by flattening its oldest entries
 * into the first user turn as a text transcript.
 *
 * Nothing is dropped: tool calls and results survive as text, so the model
 * still sees them, only no longer as structured entries. The first entry keeps
 * its place at the top because it carries the system prompt. Images in the
 * folded part are replaced by a count. Returns the input unchanged when it is
 * already under the limit or when no user turn is left to start the kept tail.
 */
export function foldHistoryToLimit(
  history: CodeWhispererMessage[],
  limit: number = MAX_HISTORY_ENTRIES
): CodeWhispererMessage[] {
  const first = history[0]?.userInputMessage
  if (history.length <= limit || !first) return history

  const cut = findTailStart(history, history.length - limit + FOLDED_ENTRY_COUNT)
  if (cut === -1) return history

  const transcript = history.slice(1, cut).map(renderEntry).filter(Boolean)
  const foldedContent = [first.content, ...renderUserExtras(first), FOLDED_HEADER, ...transcript]
    .filter(Boolean)
    .join('\n\n')

  return [
    { userInputMessage: { content: foldedContent, modelId: first.modelId, origin: first.origin } },
    { assistantResponseMessage: { content: FOLDED_REPLY } },
    detachToolResults(history[cut]!),
    ...history.slice(cut + 1)
  ]
}

/** First user entry at or after `from`, so the kept tail opens on a user turn. */
function findTailStart(history: CodeWhispererMessage[], from: number): number {
  for (let index = from; index < history.length; index++) {
    if (history[index]?.userInputMessage) return index
  }
  return -1
}

/**
 * The tail's opening entry may answer tool calls that were just folded. Kiro
 * rejects tool results without a matching call, so they move into its text.
 */
function detachToolResults(entry: CodeWhispererMessage): CodeWhispererMessage {
  const input = entry.userInputMessage!
  const toolResults = input.userInputMessageContext?.toolResults
  if (!toolResults?.length) return entry

  const { toolResults: _detached, ...context } = input.userInputMessageContext!
  const content = [input.content, ...toolResults.map(renderToolResult)].join('\n\n')
  const detached: UserInput = { ...input, content }
  if (Object.keys(context).length > 0) detached.userInputMessageContext = context
  else delete detached.userInputMessageContext
  return { userInputMessage: detached }
}

function renderEntry(entry: CodeWhispererMessage): string {
  const lines: string[] = []
  const input = entry.userInputMessage
  if (input) {
    if (input.content) lines.push(`User: ${input.content}`)
    lines.push(...renderUserExtras(input))
  }
  const response = entry.assistantResponseMessage
  if (response) {
    if (response.content) lines.push(`Assistant: ${response.content}`)
    for (const toolUse of response.toolUses ?? []) {
      lines.push(
        `Tool call ${toolUse.name} (${toolUse.toolUseId}): ${JSON.stringify(toolUse.input ?? {})}`
      )
    }
  }
  return lines.join('\n')
}

function renderUserExtras(input: UserInput): string[] {
  const lines = (input.userInputMessageContext?.toolResults ?? []).map(renderToolResult)
  const imageCount = input.images?.length ?? 0
  if (imageCount > 0) lines.push(`[${imageCount} image(s) omitted]`)
  return lines
}

function renderToolResult(result: ToolResult): string {
  const text = result.content.map((part) => part.text ?? '').join('\n')
  return `Tool result (${result.toolUseId}):\n${text}`
}
