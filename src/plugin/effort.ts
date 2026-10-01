import { EFFORT_LEVELS, type Effort } from './config/schema'
import { findCatalogModel } from './models.js'

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
 * Get the effective effort level based on config, budget, and model.
 *
 * Priority:
 * 1. Explicit effort config (if set) - always applied regardless of thinking state
 * 2. Budget-to-effort mapping (if auto_effort_mapping enabled and thinking)
 * 3. 'medium' default (if thinking enabled)
 * 4. undefined (if not thinking)
 */
export function getEffectiveEffort(
  kiroModel: string,
  thinking: boolean,
  budget: number,
  configEffort?: Effort,
  autoEffortMapping = true
): Effort | undefined {
  if (!supportsEffort(kiroModel)) {
    return undefined
  }

  // Explicit config takes precedence - always applied even without thinking
  if (configEffort) {
    return resolveEffort(kiroModel, configEffort)
  }

  // If not thinking, no effort needed
  if (!thinking) {
    return undefined
  }

  // Auto-map budget to effort
  if (autoEffortMapping) {
    return budgetToEffort(budget, kiroModel)
  }

  // Default to medium when thinking without auto-mapping
  return resolveEffort(kiroModel, 'medium')
}
