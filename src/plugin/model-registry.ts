import { Model, Provider } from '@opencode/plugin'
import { THINKING_BUDGETS, THINKING_OFF_BUDGET } from './effort.js'
import { getCatalog, type KiroModel } from './model-catalog.js'
import { toOpenCodeModelID } from './models.js'

const OFF_VARIANT = 'off'

/**
 * Model definitions advertised to OpenCode, derived from the Kiro catalog.
 *
 * Every model Kiro lists is advertised as-is, including the ones it added after
 * this plugin shipped. Thinking is a variant of the model rather than a separate
 * entry: picking no variant leaves Kiro's per-model default in place, an effort
 * variant turns on adaptive thinking at that level, and `off` disables thinking
 * on models Kiro lets switch it off.
 *
 * Thinking-capable models declare `compatibility.reasoningField`. The plugin
 * streams reasoning as the non-standard `reasoning_content` delta (see
 * streaming/openai-converter.ts), so OpenCode has to be told which field carries
 * it. Without it, every reasoning chunk is silently dropped and no thinking
 * block is rendered. It goes on the base entry because some models (the Opus
 * family) reason by default, with no variant selected.
 */
export function buildModelRegistry(providerID: string): Model.Info[] {
  const provider = Provider.ID.make(providerID)
  return getCatalog().map((model) => createModel(provider, model))
}

function createModel(providerID: Provider.ID, model: KiroModel): Model.Info {
  const variants = buildVariants(model)

  return {
    ...Model.Info.default(providerID, Model.ID.make(toOpenCodeModelID(model.id))),
    name: `${model.name} (${formatRate(model.rate)})`,
    limit: { ...model.limit },
    capabilities: {
      tools: true,
      input: [...model.input],
      output: ['text']
    },
    ...(variants.length > 0
      ? {
          compatibility: { reasoningField: 'reasoning_content' as const },
          variants
        }
      : {})
  }
}

/**
 * `off` first when the model accepts `thinking.type: disabled`, then one variant
 * per effort level, lowest to highest. The budget travels as a request body
 * field, which the Kiro request builder maps back to the matching request
 * fields.
 */
function buildVariants(model: KiroModel): Model.Variant[] {
  const off = model.thinkingTypes.includes('disabled')
    ? [variant(OFF_VARIANT, THINKING_OFF_BUDGET)]
    : []
  return [...off, ...model.effortLevels.map((level) => variant(level, THINKING_BUDGETS[level]))]
}

function variant(id: string, thinkingBudget: number): Model.Variant {
  return {
    id: Model.VariantID.make(id),
    settings: { thinkingConfig: { thinkingBudget } }
  }
}

/** Kiro credit multiplier as it appears in the picker: 1 → `1.0x`, 0.25 → `0.25x`. */
function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : rate}x`
}
