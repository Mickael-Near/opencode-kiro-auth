import { getCatalog, getCatalogModel, type KiroModel } from './model-catalog.js'

/**
 * Suffix of the retired `-thinking` model IDs. Thinking is now a variant of the
 * base model; the suffix is still accepted so existing sessions keep resolving.
 */
export const THINKING_SUFFIX = '-thinking'

/**
 * Kiro's 1M variants were folded into the base models, so `-1m` is accepted and
 * dropped rather than resolved, to keep older configs working.
 */
const LONG_CONTEXT_SUFFIX = '-1m'

const DEFAULT_CONTEXT_WINDOW = 200000

/**
 * OpenCode-facing model ID for a Kiro model.
 *
 * Dots are not used in OpenCode model IDs, so `claude-opus-4.5` is advertised as
 * `claude-opus-4-5`. resolveKiroModel accepts either spelling.
 */
export function toOpenCodeModelID(kiroModelID: string): string {
  return kiroModelID.replaceAll('.', '-')
}

/** Resolve an OpenCode-facing model ID to the ID Kiro expects in `modelId`. */
export function resolveKiroModel(model: string): string {
  const resolved = findCatalogModel(model)
  if (!resolved) {
    const supported = getCatalog()
      .map((entry) => toOpenCodeModelID(entry.id))
      .join(', ')
    throw new Error(`Unsupported model: ${model}. Supported models: ${supported}`)
  }
  return resolved.id
}

/** The catalog entry behind an OpenCode-facing or Kiro model ID. */
export function findCatalogModel(model: string): KiroModel | undefined {
  let base = model
  if (base.endsWith(THINKING_SUFFIX)) base = base.slice(0, -THINKING_SUFFIX.length)
  if (base.endsWith(LONG_CONTEXT_SUFFIX)) base = base.slice(0, -LONG_CONTEXT_SUFFIX.length)

  const direct = getCatalogModel(base)
  if (direct) return direct

  return getCatalog().find((entry) => toOpenCodeModelID(entry.id) === base)
}

/**
 * Context window used to turn Kiro's context-usage percentage into a token
 * count. Unknown models fall back to the smallest window Kiro ships, which
 * under-reports rather than hiding that the context is nearly full.
 */
export function getContextWindowSize(model: string): number {
  return findCatalogModel(model)?.limit.context ?? DEFAULT_CONTEXT_WINDOW
}
