import { EFFORT_LEVELS, type Effort } from './config/schema'
import { findCatalogModel, THINKING_SUFFIX } from './models.js'
import type { ModelRequestFields, ThinkingRequest } from './types'

/**
 * Reference thinking budget for each effort level.
 *
 * Scaled to Kiro's real thinking range (1024–128000 on the deepest models)
 * rather than OpenCode's conventional 32768 cap, so every effort level is
 * reachable from a budget alone. These double as the upper bound of each mapping
 * band in budgetToEffort, and as the variant budgets the plugin advertises, so
 * the two cannot drift apart.
 */
export const THINKING_BUDGETS: Readonly<Record<Effort, number>> = {
  low: 16384,
  medium: 32768,
  high: 65536,
  xhigh: 98304,
  max: 128000
}

/**
 * Effort levels a model accepts, as Kiro declares them in its
 * `additionalModelRequestFieldsSchema`, ordered lowest to highest. Empty for
 * models Kiro gives no schema, which is how it marks "no thinking".
 */
function effortLevelsFor(kiroModel: string): readonly Effort[] {
  return findCatalogModel(kiroModel)?.effortLevels ?? []
}

/**
 * Check if a model supports the effort parameter.
 */
export function supportsEffort(kiroModel: string): boolean {
  return effortLevelsFor(kiroModel).length > 0
}

/**
 * Resolve effort level for a given model.
 * - Returns undefined if model doesn't support effort
 * - Falls back to the deepest level the model accepts for levels it rejects
 */
export function resolveEffort(kiroModel: string, requested: Effort): Effort | undefined {
  const levels = effortLevelsFor(kiroModel)
  if (levels.length === 0) {
    return undefined
  }

  if (levels.includes(requested)) {
    return requested
  }

  // levels follows EFFORT_LEVELS order, so the last entry is the deepest. Kiro
  // only ever omits levels from the top of the ladder (e.g. xhigh), so this
  // clamps rather than guesses.
  return levels[levels.length - 1]
}

/**
 * Map OpenCode thinking budget to Kiro effort level.
 *
 * Budget bands are scaled to Kiro's real thinking ceiling (1024–128000 on the
 * deepest models), not OpenCode's conventional 32768 cap, so the full effort
 * enum is reachable. Reference budgets:
 * - low:    16384
 * - medium: 32768
 * - high:   65536
 * - xhigh:  98304
 * - max:    128000
 *
 * Each THINKING_BUDGETS value is the inclusive upper bound of its band, so a
 * variant configured with a reference budget maps back to the same level:
 * - ≤16384  → low
 * - ≤32768  → medium
 * - ≤65536  → high
 * - ≤98304  → xhigh (clamped on models that reject xhigh)
 * - >98304  → max
 */
export function budgetToEffort(budget: number, kiroModel: string): Effort | undefined {
  if (!supportsEffort(kiroModel)) {
    return undefined
  }

  // EFFORT_LEVELS is ordered low→max, so the first band the budget fits wins.
  const effort =
    EFFORT_LEVELS.find((level) => budget <= THINKING_BUDGETS[level]) ??
    EFFORT_LEVELS[EFFORT_LEVELS.length - 1]!

  return resolveEffort(kiroModel, effort)
}

/**
 * Budget of the `off` variant. Zero is the conventional "no thinking" budget,
 * and sits below every band, so it cannot be mistaken for an effort level.
 */
export const THINKING_OFF_BUDGET = 0

/** Budget assumed for a legacy `-thinking` model ID used without a variant. */
const DEFAULT_THINKING_BUDGET = 20000

/**
 * What the user asked for, read from the OpenCode request body.
 *
 * No variant means "default", not "off": OpenCode leaves the choice to the
 * provider, and Kiro's own default differs per model (Opus reasons, Sonnet does
 * not), so the plugin must not override it.
 */
export function parseThinkingRequest(model: string, body: any): ThinkingRequest {
  const config = body?.providerOptions?.thinkingConfig ?? body?.thinkingConfig
  const budget = config?.thinkingBudget ?? config?.budget_tokens

  if (budget === THINKING_OFF_BUDGET) return { kind: 'off' }
  if (typeof budget === 'number') return { kind: 'on', budget }
  if (config || model.endsWith(THINKING_SUFFIX)) {
    return { kind: 'on', budget: DEFAULT_THINKING_BUDGET }
  }
  return { kind: 'default' }
}

/**
 * Check if thinking can be switched off for a model. Kiro declares it by listing
 * `disabled` in the model's `thinking.type` enum.
 */
export function supportsThinkingOff(kiroModel: string): boolean {
  return findCatalogModel(kiroModel)?.thinkingTypes.includes('disabled') ?? false
}

/**
 * Build the `additionalModelRequestFields` for a request, or undefined to let
 * Kiro apply the model's defaults.
 *
 * - off: `thinking.type: disabled` where the model accepts it. Models that
 *   always reason get nothing rather than a request Kiro would reject with 400.
 * - on: adaptive thinking at the selected effort. Sonnet only streams its
 *   reasoning when `thinking.type: adaptive` is sent; effort alone is not enough.
 * - default: nothing, unless the config pins an effort level.
 *
 * An explicit `effort` in the config overrides the variant's level, but never
 * an explicit `off`.
 */
export function resolveModelRequestFields(
  kiroModel: string,
  request: ThinkingRequest,
  configEffort?: Effort,
  autoEffortMapping = true
): ModelRequestFields | undefined {
  if (request.kind === 'off') {
    return supportsThinkingOff(kiroModel) ? { thinking: { type: 'disabled' } } : undefined
  }

  const effort = requestedEffort(kiroModel, request, configEffort, autoEffortMapping)
  if (!effort) return undefined

  const adaptive = findCatalogModel(kiroModel)?.thinkingTypes.includes('adaptive')
  return {
    ...(adaptive ? { thinking: { type: 'adaptive' as const } } : {}),
    output_config: { effort }
  }
}

function requestedEffort(
  kiroModel: string,
  request: ThinkingRequest,
  configEffort: Effort | undefined,
  autoEffortMapping: boolean
): Effort | undefined {
  if (configEffort) return resolveEffort(kiroModel, configEffort)
  if (request.kind !== 'on') return undefined
  return autoEffortMapping
    ? budgetToEffort(request.budget, kiroModel)
    : resolveEffort(kiroModel, 'medium')
}
