import { Model, Provider } from '@opencode/plugin'
import { EFFORT_LEVELS, supportsEffort, supportsXHighEffort, THINKING_BUDGETS } from './effort.js'
import { resolveKiroModel } from './models.js'

type Modalities = {
  input: Array<'text' | 'image' | 'pdf'>
  output: ['text']
}

const TEXT_ONLY: Modalities = { input: ['text'], output: ['text'] }
const TEXT_IMAGE: Modalities = { input: ['text', 'image'], output: ['text'] }
const MULTIMODAL: Modalities = { input: ['text', 'image', 'pdf'], output: ['text'] }

const CONTEXT_200K = { context: 200000, output: 64000 }
const CONTEXT_1M = { context: 1000000, output: 64000 }

interface ModelSpec {
  /** Display name, without the credit multiplier suffix. */
  name: string
  /** Kiro credit multiplier, rendered into the display name. */
  rate: string
  limit: { context: number; output: number }
  modalities: Modalities
  /**
   * Emit a companion `-thinking` entry. Only set for Claude models that accept
   * `output_config.effort`; the effort ladder is derived from the model's own
   * capabilities in effort.ts.
   */
  thinking?: boolean
}

/**
 * Models Kiro exposes, keyed by the OpenCode-facing model ID.
 *
 * Anthropic and open-weight models only. Kiro's GPT-5.6 tiers are deliberately
 * absent: they configure reasoning through `reasoning.effort` / `reasoning.mode`
 * rather than `output_config.effort`, so they need their own request path.
 */
const MODEL_SPECS: Record<string, ModelSpec> = {
  auto: { name: 'Auto', rate: '1.0x', limit: CONTEXT_200K, modalities: MULTIMODAL },

  // Claude Sonnet
  'claude-sonnet-4': {
    name: 'Claude Sonnet 4.0',
    rate: '1.3x',
    limit: CONTEXT_200K,
    modalities: MULTIMODAL
  },
  'claude-sonnet-4-5': {
    name: 'Claude Sonnet 4.5',
    rate: '1.3x',
    limit: CONTEXT_200K,
    modalities: MULTIMODAL,
    thinking: true
  },
  'claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6',
    rate: '1.3x',
    limit: CONTEXT_1M,
    modalities: MULTIMODAL,
    thinking: true
  },
  'claude-sonnet-5': {
    name: 'Claude Sonnet 5',
    rate: '1.3x',
    limit: CONTEXT_1M,
    modalities: MULTIMODAL,
    thinking: true
  },

  // Claude Haiku
  'claude-haiku-4-5': {
    name: 'Claude Haiku 4.5',
    rate: '0.4x',
    limit: CONTEXT_200K,
    modalities: TEXT_IMAGE
  },

  // Claude Opus
  'claude-opus-4-5': {
    name: 'Claude Opus 4.5',
    rate: '2.2x',
    limit: CONTEXT_200K,
    modalities: MULTIMODAL,
    thinking: true
  },
  'claude-opus-4-6': {
    name: 'Claude Opus 4.6',
    rate: '2.2x',
    limit: CONTEXT_1M,
    modalities: MULTIMODAL,
    thinking: true
  },
  'claude-opus-4-7': {
    name: 'Claude Opus 4.7',
    rate: '2.2x',
    limit: CONTEXT_1M,
    modalities: MULTIMODAL,
    thinking: true
  },
  'claude-opus-4-8': {
    name: 'Claude Opus 4.8',
    rate: '2.2x',
    limit: CONTEXT_1M,
    modalities: MULTIMODAL,
    thinking: true
  },
  'claude-opus-5': {
    name: 'Claude Opus 5',
    rate: '2.2x',
    limit: CONTEXT_1M,
    modalities: MULTIMODAL,
    thinking: true
  },

  // Open weight models
  'deepseek-3.2': {
    name: 'DeepSeek 3.2',
    rate: '0.25x',
    limit: { context: 128000, output: 64000 },
    modalities: TEXT_ONLY
  },
  'glm-5': { name: 'GLM-5', rate: '0.5x', limit: CONTEXT_200K, modalities: TEXT_ONLY },
  'minimax-m2.5': {
    name: 'MiniMax M2.5',
    rate: '0.25x',
    limit: { context: 196000, output: 64000 },
    modalities: TEXT_ONLY
  },
  'minimax-m2.1': {
    name: 'MiniMax M2.1',
    rate: '0.15x',
    limit: { context: 196000, output: 64000 },
    modalities: TEXT_ONLY
  },
  'qwen3-coder-next': {
    name: 'Qwen3 Coder Next',
    rate: '0.05x',
    limit: { context: 256000, output: 64000 },
    modalities: TEXT_ONLY
  }
}

/**
 * Build the thinking variants a model supports.
 *
 * Levels come from the model's own effort capabilities, so xhigh only appears on
 * models that accept it and the budgets stay in step with budgetToEffort. The
 * budget travels as a request body field, which the Kiro request builder reads
 * to pick the matching `output_config.effort`.
 */
function buildVariants(kiroModel: string): Model.Variant[] {
  const variants: Model.Variant[] = []

  for (const level of EFFORT_LEVELS) {
    if (level === 'xhigh' && !supportsXHighEffort(kiroModel)) continue
    variants.push({
      id: Model.VariantID.make(level),
      settings: { thinkingConfig: { thinkingBudget: THINKING_BUDGETS[level] } }
    })
  }

  return variants
}

/**
 * Model definitions advertised to OpenCode.
 *
 * `-thinking` entries declare `compatibility.reasoningField`. The plugin streams
 * reasoning as the non-standard `reasoning_content` delta (see
 * streaming/openai-converter.ts), so OpenCode has to be told which field carries
 * it. Without it, every reasoning chunk is silently dropped and no thinking
 * block is rendered.
 */
export function buildModelRegistry(providerID: string): Model.Info[] {
  const models: Model.Info[] = []
  const provider = Provider.ID.make(providerID)

  for (const [modelID, spec] of Object.entries(MODEL_SPECS)) {
    models.push(createModel(provider, modelID, spec, false))

    if (!spec.thinking) continue

    // Effort capability is keyed on the resolved Kiro model ID (e.g. claude-opus-5
    // vs claude-sonnet-4.5), not the OpenCode-facing one.
    const kiroModel = resolveKiroModel(modelID)
    if (!supportsEffort(kiroModel)) continue

    models.push(createModel(provider, `${modelID}-thinking`, spec, true))
  }

  return models
}

function createModel(
  providerID: Provider.ID,
  modelID: string,
  spec: ModelSpec,
  thinking: boolean
): Model.Info {
  const kiroModel = resolveKiroModel(modelID)

  return {
    ...Model.Info.default(providerID, Model.ID.make(modelID)),
    name: thinking ? `${spec.name} Thinking (${spec.rate})` : `${spec.name} (${spec.rate})`,
    limit: spec.limit,
    capabilities: {
      tools: true,
      input: [...spec.modalities.input],
      output: [...spec.modalities.output]
    },
    ...(thinking
      ? {
          compatibility: { reasoningField: 'reasoning_content' as const },
          variants: buildVariants(kiroModel)
        }
      : {})
  }
}
