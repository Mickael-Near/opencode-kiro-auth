import { buildUrl, extractRegionFromArn, KIRO_CONSTANTS } from '../constants.js'
import { EFFORT_LEVELS, type Effort } from './config/schema.js'
import * as logger from './logger.js'
import type { KiroAuthDetails, ThinkingType } from './types'

// Plugin setup waits on this call, so the ceiling is what a user tolerates
// before the model picker is usable, not what the network might need.
const REQUEST_TIMEOUT_MS = 10_000

export type Modality = 'text' | 'image'

/** Kiro's input type names, mapped to the OpenCode modality names. */
const INPUT_MODALITIES: Readonly<Record<string, Modality>> = {
  TEXT: 'text',
  IMAGE: 'image'
}

const DEFAULT_RATE = 1
const DEFAULT_CONTEXT = 200000
const DEFAULT_OUTPUT = 64000

/** A model Kiro offers, in the shape the registry and the request path need. */
export interface KiroModel {
  /** Kiro's own model ID, as sent in `modelId`, e.g. `claude-opus-5.5`. */
  id: string
  /** Kiro's display name, e.g. `Claude Opus 5.5`. */
  name: string
  /** Kiro credit multiplier, e.g. 2.2. */
  rate: number
  limit: { context: number; output: number }
  input: readonly Modality[]
  /**
   * Effort levels Kiro accepts in `output_config.effort`. Empty for models that
   * declare no request-field schema, which is how Kiro marks "no thinking".
   */
  effortLevels: readonly Effort[]
  /**
   * Values Kiro accepts in `thinking.type`. Only models listing `disabled` can
   * have thinking switched off; Opus 5.5, for one, always reasons.
   */
  thinkingTypes: readonly ThinkingType[]
}

const THINKING_TYPES: readonly ThinkingType[] = ['adaptive', 'disabled']

const NO_EFFORT: readonly Effort[] = []
const FULL_EFFORT = EFFORT_LEVELS
const EFFORT_WITHOUT_XHIGH = EFFORT_LEVELS.filter((level) => level !== 'xhigh')
const NO_THINKING: readonly ThinkingType[] = []
const ADAPTIVE_ONLY: readonly ThinkingType[] = ['adaptive']
const ADAPTIVE_OR_DISABLED = THINKING_TYPES
const TEXT: readonly Modality[] = ['text']
const TEXT_IMAGE: readonly Modality[] = ['text', 'image']

const CONTEXT_1M = { context: 1000000, output: 128000 }
const CONTEXT_1M_SHORT_OUTPUT = { context: 1000000, output: 64000 }
const CONTEXT_200K = { context: 200000, output: 64000 }

/**
 * Snapshot of `ListAvailableModels`, used until the live call succeeds and
 * whenever it cannot be made (no account yet, offline, expired subscription).
 *
 * Kiro ships models every few weeks, so this list goes stale by design: it is a
 * floor, not the source of truth. Ordering follows Kiro's own, which the model
 * picker surfaces as-is.
 */
export const FALLBACK_CATALOG: readonly KiroModel[] = [
  {
    id: 'auto',
    name: 'Auto',
    rate: 1.0,
    limit: CONTEXT_1M_SHORT_OUTPUT,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'claude-opus-5.5',
    name: 'Claude Opus 5.5',
    rate: 2.0,
    limit: CONTEXT_1M,
    input: TEXT_IMAGE,
    effortLevels: FULL_EFFORT,
    thinkingTypes: ADAPTIVE_ONLY
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    rate: 2.2,
    limit: CONTEXT_1M,
    input: TEXT_IMAGE,
    effortLevels: FULL_EFFORT,
    thinkingTypes: ADAPTIVE_OR_DISABLED
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    rate: 1.3,
    limit: CONTEXT_1M_SHORT_OUTPUT,
    input: TEXT_IMAGE,
    effortLevels: FULL_EFFORT,
    thinkingTypes: ADAPTIVE_OR_DISABLED
  },
  {
    id: 'claude-opus-4.8',
    name: 'Claude Opus 4.8',
    rate: 2.2,
    limit: CONTEXT_1M,
    input: TEXT_IMAGE,
    effortLevels: FULL_EFFORT,
    thinkingTypes: ADAPTIVE_OR_DISABLED
  },
  {
    id: 'gpt-5.6-sol',
    name: 'GPT 5.6 Sol',
    rate: 4.4,
    limit: CONTEXT_1M,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'gpt-5.6-terra',
    name: 'GPT 5.6 Terra',
    rate: 2.2,
    limit: CONTEXT_1M,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'gpt-5.6-luna',
    name: 'GPT 5.6 Luna',
    rate: 0.6,
    limit: CONTEXT_1M,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'claude-opus-4.7',
    name: 'Claude Opus 4.7',
    rate: 2.2,
    limit: CONTEXT_1M,
    input: TEXT_IMAGE,
    effortLevels: FULL_EFFORT,
    thinkingTypes: ADAPTIVE_OR_DISABLED
  },
  {
    id: 'claude-opus-4.6',
    name: 'Claude Opus 4.6',
    rate: 2.2,
    limit: CONTEXT_1M_SHORT_OUTPUT,
    input: TEXT_IMAGE,
    effortLevels: EFFORT_WITHOUT_XHIGH,
    thinkingTypes: ADAPTIVE_OR_DISABLED
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    rate: 1.3,
    limit: CONTEXT_1M_SHORT_OUTPUT,
    input: TEXT_IMAGE,
    effortLevels: EFFORT_WITHOUT_XHIGH,
    thinkingTypes: ADAPTIVE_OR_DISABLED
  },
  {
    id: 'claude-opus-4.5',
    name: 'Claude Opus 4.5',
    rate: 2.2,
    limit: CONTEXT_200K,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'claude-sonnet-4.5',
    name: 'Claude Sonnet 4.5',
    rate: 1.3,
    limit: CONTEXT_200K,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    rate: 1.3,
    limit: CONTEXT_200K,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'claude-haiku-4.5',
    name: 'Claude Haiku 4.5',
    rate: 0.4,
    limit: CONTEXT_200K,
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'deepseek-3.2',
    name: 'Deepseek v3.2',
    rate: 0.25,
    limit: { context: 164000, output: DEFAULT_OUTPUT },
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    rate: 0.25,
    limit: { context: 196000, output: DEFAULT_OUTPUT },
    input: TEXT,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'minimax-m2.1',
    name: 'MiniMax M2.1',
    rate: 0.15,
    limit: { context: 196000, output: DEFAULT_OUTPUT },
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'glm-5',
    name: 'GLM 5',
    rate: 0.5,
    limit: CONTEXT_200K,
    input: TEXT,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  },
  {
    id: 'qwen3-coder-next',
    name: 'Qwen3 Coder Next',
    rate: 0.05,
    limit: { context: 256000, output: DEFAULT_OUTPUT },
    input: TEXT_IMAGE,
    effortLevels: NO_EFFORT,
    thinkingTypes: NO_THINKING
  }
]

let catalog: readonly KiroModel[] = FALLBACK_CATALOG
let byID = indexByID(FALLBACK_CATALOG)

function indexByID(models: readonly KiroModel[]): ReadonlyMap<string, KiroModel> {
  return new Map(models.map((model) => [model.id, model]))
}

/** Every model the plugin currently advertises, in Kiro's own order. */
export function getCatalog(): readonly KiroModel[] {
  return catalog
}

/** Look a model up by its Kiro ID, e.g. `claude-opus-5.5`. */
export function getCatalogModel(kiroModelID: string): KiroModel | undefined {
  return byID.get(kiroModelID)
}

/** Replace the active catalog. Exposed for the loader and for tests. */
export function activateCatalog(models: readonly KiroModel[]): void {
  catalog = models
  byID = indexByID(models)
}

/**
 * Point the registry at Kiro's live model list, keeping FALLBACK_CATALOG on any
 * failure. Model discovery must never block the provider from registering, so
 * every error (token refresh, HTTP, malformed payload) is logged and swallowed.
 *
 * Called once from plugin setup. Concurrent calls are not ordered: the last
 * response to arrive wins, whichever was issued first.
 */
export async function loadCatalog(resolveAuth: () => Promise<KiroAuthDetails>): Promise<void> {
  try {
    const models = await fetchCatalog(await resolveAuth())
    activateCatalog(models)
    logger.log(`Models: loaded ${models.length} model(s) from Kiro`)
  } catch (e) {
    logger.warn(
      `Models: ListAvailableModels failed, using bundled snapshot: ${
        e instanceof Error ? e.message : String(e)
      }`
    )
  }
}

interface AvailableModel {
  modelId?: string
  modelName?: string
  rateMultiplier?: number
  tokenLimits?: { maxInputTokens?: number; maxOutputTokens?: number }
  supportedInputTypes?: string[]
  additionalModelRequestFieldsSchema?: {
    properties?: {
      thinking?: { properties?: { type?: { enum?: string[] } } }
      output_config?: { properties?: { effort?: { enum?: string[] } } }
    }
  } | null
}

async function fetchCatalog(auth: KiroAuthDetails): Promise<readonly KiroModel[]> {
  const region = extractRegionFromArn(auth.profileArn) ?? auth.region
  const url = new URL(buildUrl(KIRO_CONSTANTS.AVAILABLE_MODELS_URL, region))
  url.searchParams.set('origin', KIRO_CONSTANTS.ORIGIN_AI_EDITOR)
  if (auth.profileArn) url.searchParams.set('profileArn', auth.profileArn)

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${auth.access}`,
      'Content-Type': 'application/json',
      // Kiro gates this endpoint on the IDE user agent. Without it the call is
      // rejected with 403 "Your subscription does not support this application",
      // even for an account that can run inference.
      'user-agent': KIRO_CONSTANTS.USER_AGENT,
      'x-amzn-kiro-agent-mode': 'vibe'
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`)
  }

  const data = (await res.json()) as { models?: AvailableModel[] }
  const models = (data.models ?? [])
    .map(parseModel)
    .filter((model): model is KiroModel => model !== undefined)

  if (models.length === 0) throw new Error('response listed no usable models')
  return models
}

function parseModel(raw: AvailableModel): KiroModel | undefined {
  const id = raw.modelId
  if (typeof id !== 'string' || id.length === 0) return undefined
  const schema = raw.additionalModelRequestFieldsSchema?.properties

  return {
    id,
    name: raw.modelName || id,
    rate: typeof raw.rateMultiplier === 'number' ? raw.rateMultiplier : DEFAULT_RATE,
    limit: {
      context: raw.tokenLimits?.maxInputTokens || DEFAULT_CONTEXT,
      output: raw.tokenLimits?.maxOutputTokens || DEFAULT_OUTPUT
    },
    input: parseModalities(raw.supportedInputTypes),
    effortLevels: parseKnown(schema?.output_config?.properties?.effort?.enum, EFFORT_LEVELS),
    thinkingTypes: parseKnown(schema?.thinking?.properties?.type?.enum, THINKING_TYPES)
  }
}

function parseModalities(types: string[] | undefined): readonly Modality[] {
  const modalities = (types ?? [])
    .map((type) => INPUT_MODALITIES[type])
    .filter((modality): modality is Modality => modality !== undefined)

  // Every Kiro model accepts text, so an unrecognised list means a new input
  // type was added rather than a text-less model.
  return modalities.length > 0 ? modalities : TEXT
}

/**
 * Keep only the values the plugin knows, in `known` order. For effort that is
 * lowest to highest, which resolveEffort relies on.
 */
function parseKnown<T extends string>(values: string[] | undefined, known: readonly T[]): T[] {
  if (!values) return []
  const accepted = new Set(values)
  return known.filter((value) => accepted.has(value))
}
