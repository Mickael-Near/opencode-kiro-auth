import { Model, Provider } from '@opencode/plugin'
import { THINKING_BUDGETS } from './effort.js'
import { getCatalog, type KiroModel } from './model-catalog.js'
import { THINKING_SUFFIX, toOpenCodeModelID } from './models.js'

/**
 * Model definitions advertised to OpenCode, derived from the Kiro catalog.
 *
 * Every model Kiro lists is advertised as-is, including the ones it added after
 * this plugin shipped. Models that declare an `output_config.effort` schema also
 * get a `-thinking` companion whose variants mirror the effort levels Kiro
 * accepts for that model.
 *
 * `-thinking` entries declare `compatibility.reasoningField`. The plugin streams
 * reasoning as the non-standard `reasoning_content` delta (see
 * streaming/openai-converter.ts), so OpenCode has to be told which field carries
 * it. Without it, every reasoning chunk is silently dropped and no thinking
 * block is rendered.
 */
export function buildModelRegistry(providerID: string): Model.Info[] {
  const provider = Provider.ID.make(providerID)
  const models: Model.Info[] = []

  for (const model of getCatalog()) {
    models.push(createModel(provider, model, false))

    if (model.effortLevels.length > 0) {
      models.push(createModel(provider, model, true))
    }
  }

  return models
}

function createModel(providerID: Provider.ID, model: KiroModel, thinking: boolean): Model.Info {
  const modelID = toOpenCodeModelID(model.id) + (thinking ? THINKING_SUFFIX : '')
  const suffix = `${thinking ? ' Thinking' : ''} (${formatRate(model.rate)})`

  return {
    ...Model.Info.default(providerID, Model.ID.make(modelID)),
    name: `${model.name}${suffix}`,
    limit: { ...model.limit },
    capabilities: {
      tools: true,
      input: [...model.input],
      output: ['text']
    },
    ...(thinking
      ? {
          compatibility: { reasoningField: 'reasoning_content' as const },
          variants: buildVariants(model)
        }
      : {})
  }
}

/**
 * Build one variant per effort level the model accepts, ordered lowest to
 * highest. The budget travels as a request body field, which the Kiro request
 * builder maps back to the matching `output_config.effort`.
 */
function buildVariants(model: KiroModel): Model.Variant[] {
  return model.effortLevels.map((level) => ({
    id: Model.VariantID.make(level),
    settings: { thinkingConfig: { thinkingBudget: THINKING_BUDGETS[level] } }
  }))
}

/** Kiro credit multiplier as it appears in the picker: 1 → `1.0x`, 0.25 → `0.25x`. */
function formatRate(rate: number): string {
  return `${Number.isInteger(rate) ? rate.toFixed(1) : rate}x`
}
