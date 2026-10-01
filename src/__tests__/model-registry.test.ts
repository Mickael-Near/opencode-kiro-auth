import { afterEach, describe, expect, test } from 'bun:test'
import type { Effort } from '../plugin/config/schema.js'
import {
  budgetToEffort,
  parseThinkingRequest,
  THINKING_BUDGETS,
  THINKING_OFF_BUDGET
} from '../plugin/effort.js'
import { activateCatalog, FALLBACK_CATALOG, type KiroModel } from '../plugin/model-catalog.js'
import { buildModelRegistry } from '../plugin/model-registry.js'
import { resolveKiroModel } from '../plugin/models.js'

function buildRegistry() {
  return new Map(buildModelRegistry('kiro').map((model) => [model.id as string, model]))
}

function variantIDs(id: string, registry = buildRegistry()): string[] {
  return (registry.get(id)?.variants ?? []).map((variant) => String(variant.id))
}

function variantBudget(variant: { settings?: Record<string, unknown> }): number {
  return (variant.settings?.thinkingConfig as { thinkingBudget: number }).thinkingBudget
}

const registry = buildRegistry()
const thinkingModels = FALLBACK_CATALOG.filter((model) => model.effortLevels.length > 0)

afterEach(() => activateCatalog(FALLBACK_CATALOG))

describe('model registry', () => {
  test('advertises one entry per catalog model, resolvable back to its Kiro ID', () => {
    expect(registry.size).toBe(FALLBACK_CATALOG.length)
    for (const model of FALLBACK_CATALOG) {
      const modelID = model.id.replaceAll('.', '-')
      expect(registry.has(modelID)).toBe(true)
      expect(resolveKiroModel(modelID)).toBe(model.id)
    }
  })

  // Thinking is a variant now; the retired IDs only survive on the request path.
  test('advertises no -thinking entries', () => {
    expect([...registry.keys()].filter((id) => id.endsWith('-thinking'))).toEqual([])
    expect(resolveKiroModel('claude-opus-5-5-thinking')).toBe('claude-opus-5.5')
  })

  test('renders the Kiro credit multiplier into the display name', () => {
    expect(registry.get('claude-opus-5-5')?.name).toBe('Claude Opus 5.5 (2.0x)')
    expect(registry.get('claude-opus-5')?.name).toBe('Claude Opus 5 (2.2x)')
    expect(registry.get('qwen3-coder-next')?.name).toBe('Qwen3 Coder Next (0.05x)')
  })

  describe('reasoning capability flags', () => {
    // `compatibility.reasoningField` tells OpenCode reasoning arrives as
    // `reasoning_content` deltas. Without it reasoning chunks are silently
    // dropped. Opus reasons with no variant selected, so it is always declared.
    test('every thinking-capable model declares the reasoning_content field', () => {
      for (const model of thinkingModels) {
        expect(registry.get(model.id.replaceAll('.', '-'))?.compatibility).toEqual({
          reasoningField: 'reasoning_content'
        })
      }
    })

    test('models without thinking declare no compatibility overrides or variants', () => {
      for (const model of FALLBACK_CATALOG.filter((entry) => entry.effortLevels.length === 0)) {
        const entry = registry.get(model.id.replaceAll('.', '-'))
        expect(entry?.compatibility).toBeUndefined()
        expect(entry?.variants).toEqual([])
      }
    })
  })

  describe('thinking variants', () => {
    test('offers off only where Kiro lets thinking be disabled', () => {
      expect(variantIDs('claude-sonnet-4-6', registry)).toEqual([
        'off',
        'low',
        'medium',
        'high',
        'max'
      ])
      expect(variantIDs('claude-opus-5-5', registry)).toEqual([
        'low',
        'medium',
        'high',
        'xhigh',
        'max'
      ])
    })

    test('offers exactly the effort levels Kiro accepts for the model', () => {
      for (const model of thinkingModels) {
        const levels = variantIDs(model.id.replaceAll('.', '-'), registry).filter(
          (id) => id !== 'off'
        )
        expect(levels).toEqual([...model.effortLevels])
      }
    })

    test('effort variant budgets map back to the level they are named for', () => {
      for (const model of thinkingModels) {
        for (const variant of registry.get(model.id.replaceAll('.', '-'))?.variants ?? []) {
          if (String(variant.id) === 'off') continue
          const level = String(variant.id) as Effort
          expect(variantBudget(variant)).toBe(THINKING_BUDGETS[level])
          expect(budgetToEffort(variantBudget(variant), model.id)).toBe(level)
        }
      }
    })

    test('the off variant reads back as an explicit off', () => {
      const off = registry.get('claude-sonnet-4-6')?.variants.find((v) => String(v.id) === 'off')
      expect(off && variantBudget(off)).toBe(THINKING_OFF_BUDGET)
      expect(parseThinkingRequest('claude-sonnet-4-6', { providerOptions: off?.settings })).toEqual(
        { kind: 'off' }
      )
    })

    test('variants are ordered off, then low to max', () => {
      for (const model of thinkingModels) {
        const budgets = (registry.get(model.id.replaceAll('.', '-'))?.variants ?? []).map(
          variantBudget
        )
        expect(budgets).toEqual([...budgets].sort((a, b) => a - b))
      }
    })
  })

  test('carries limit and capabilities through from the catalog', () => {
    expect(registry.get('claude-opus-5')?.limit).toEqual({ context: 1000000, output: 128000 })
    expect(registry.get('claude-opus-5')?.capabilities.input).toEqual(['text', 'image'])
    expect(registry.get('glm-5')?.capabilities.input).toEqual(['text'])
  })

  // A model Kiro adds after this plugin ships has to appear without a code change.
  test('advertises models the bundled snapshot has never seen', () => {
    const unknown: KiroModel = {
      id: 'claude-fable-6.1',
      name: 'Claude Fable 6.1',
      rate: 6,
      limit: { context: 1000000, output: 128000 },
      input: ['text', 'image'],
      effortLevels: ['low', 'medium', 'high'],
      thinkingTypes: ['adaptive', 'disabled']
    }
    activateCatalog([unknown])

    const fresh = buildRegistry()
    expect([...fresh.keys()]).toEqual(['claude-fable-6-1'])
    expect(fresh.get('claude-fable-6-1')?.name).toBe('Claude Fable 6.1 (6.0x)')
    expect(variantIDs('claude-fable-6-1', fresh)).toEqual(['off', 'low', 'medium', 'high'])
  })
})
