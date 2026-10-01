import z from 'zod'
import { EffortSchema, RegionSchema } from './config/schema'

export type KiroAuthMethod = 'idc' | 'desktop'
export type KiroRegion = z.infer<typeof RegionSchema>
export type Effort = z.infer<typeof EffortSchema>

export interface KiroAuthDetails {
  refresh: string
  access: string
  expires: number
  authMethod: KiroAuthMethod
  region: KiroRegion
  oidcRegion?: KiroRegion
  clientId?: string
  clientSecret?: string
  email?: string
  profileArn?: string
}

export interface RefreshParts {
  refreshToken: string
  clientId?: string
  clientSecret?: string
  profileArn?: string
  authMethod?: KiroAuthMethod
}

export interface ManagedAccount {
  id: string
  email: string
  authMethod: KiroAuthMethod
  region: KiroRegion
  oidcRegion?: KiroRegion
  clientId?: string
  clientSecret?: string
  profileArn?: string
  startUrl?: string
  refreshToken: string
  accessToken: string
  expiresAt: number
  rateLimitResetTime: number
  isHealthy: boolean
  unhealthyReason?: string
  recoveryTime?: number
  failCount: number
  usedCount?: number
  limitCount?: number
  lastSync?: number
  lastUsed?: number
}

export interface CodeWhispererMessage {
  userInputMessage?: {
    content: string
    modelId: string
    origin: string
    images?: Array<{ format: string; source: { bytes: Uint8Array } }>
    userInputMessageContext?: {
      toolResults?: Array<{
        toolUseId: string
        content: Array<{ text?: string }>
        status?: string
      }>
      tools?: Array<{
        toolSpecification: {
          name: string
          description: string
          inputSchema: { json: Record<string, unknown> }
        }
      }>
    }
  }
  assistantResponseMessage?: {
    content: string
    toolUses?: Array<{
      input: any
      name: string
      toolUseId: string
    }>
  }
}

export interface CodeWhispererRequest {
  conversationState: {
    chatTriggerType: string
    conversationId: string
    history?: CodeWhispererMessage[]
    currentMessage: CodeWhispererMessage
  }
  profileArn?: string
}

export interface ToolCall {
  toolUseId: string
  name: string
  input: string | Record<string, unknown>
}

export interface ParsedResponse {
  content: string
  toolCalls: ToolCall[]
  stopReason?: string
  inputTokens?: number
  outputTokens?: number
}

export type ToolNameMap = Readonly<Record<string, string>>

export interface PreparedRequest {
  url: string
  init: RequestInit
  streaming: boolean
  effectiveModel: string
  conversationId: string
  toolNameMap?: ToolNameMap
}

export interface SdkPreparedRequest {
  conversationState: CodeWhispererRequest['conversationState']
  profileArn?: string
  streaming: boolean
  effectiveModel: string
  conversationId: string
  region: string
  toolNameMap?: ToolNameMap
  /** Thinking controls sent as `additionalModelRequestFields`, if any. */
  modelRequestFields?: ModelRequestFields
}

/**
 * The thinking choice carried by an OpenCode request: no variant selected, the
 * `off` variant, or an effort variant expressed as a thinking budget.
 */
export type ThinkingRequest = { kind: 'default' } | { kind: 'off' } | { kind: 'on'; budget: number }

/** Values Kiro accepts in `thinking.type`, depending on the model. */
export type ThinkingType = 'adaptive' | 'disabled'

/**
 * The subset of Kiro's `additionalModelRequestFields` the plugin sends. Omitted
 * entirely when the user picked no variant, so Kiro applies its own defaults.
 */
export interface ModelRequestFields {
  thinking?: { type: ThinkingType }
  output_config?: { effort: Effort }
}

export type AccountSelectionStrategy = 'sticky' | 'round-robin' | 'lowest-usage'
