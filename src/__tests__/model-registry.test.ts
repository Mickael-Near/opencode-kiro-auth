import { afterEach, describe, expect, test } from 'bun:test'
import type { Effort } from '../plugin/config/schema.js'
import { budgetToEffort, THINKING_BUDGETS } from '../plugin/effort.js'
import { activateCatalog, FALLBACK_CATALOG, type KiroModel } from '../plugin/model-catalog.js'
import { buildModelRegistry } from '../plugin/model-registry.js'
import { resolveKiroModel } from '../plugin/models.js'

function buildRegistry() {
  return new Map(buildModelRegistry('kiro').map((model) => [model.id as string, model]))
}

const registry = buildRegistry()
const thinkingIDs = [...registry.keys()].filter((id) => id.endsWith('-thinking'))

afterEach(() => activateCatalog(FALLBACK_CATALOG))

describe('model registry', () => {
  test('advertises every catalog model, resolvable back to its Kiro ID', () => {
    for (const model of FALLBACK_CATALOG) {
      const modelID = model.id.replaceAll('.', '-')
      expect(registry.has(modelID)).toBe(true)
      expect(resolveKiroModel(modelID)).toBe(model.id)
    }
  })

  test('advertises a thinking companion for exactly the effort-capable models', () => {
    const expected = FALLBACK_CATALOG.filter((model) => model.effortLevels.length > 0).map(
      (model) => `${model.id.replaceAll('.', '-')}-thinking`
    )
    expect(thinkingIDs.sort()).toEqual(expected.sort())
  })

  test('renders the Kiro credit multiplier into the display name', () => {
    expect(registry.get('claude-opus-5-5')?.name).toBe('Claude Opus 5.5 (2.0x)')
    expect(registry.get('claude-opus-5-thinking')?.name).toBe('Claude Opus 5 Thinking (2.2x)')
    expect(registry.get('qwen3-coder-next')?.name).toBe('Qwen3 Coder Next (0.05x)')
  })

  describe('reasoning capability flags', () => {
    // `compatibility.reasoningField` tells OpenCode reasoning arrives as
    // `reasoning_content` deltas. Without it reasoning chunks are silently dropped.
    test('every thinking model declares the reasoning_content field', () => {
      for (const id of thinkingIDs) {
        expect(registry.get(id)?.compatibility).toEqual({ reasoningField: 'reasoning_content' })
      }
    })

    test('non-thinking models declare no compatibility overrides', () => {
      for (const [id, model] of registry) {
        if (id.endsWith('-thinking')) continue
        expect(model.compatibility).toBeUndefined()
      }
    })
  })

  describe('thinking variants', () => {
    test('offers exactly the effort levels Kiro accepts for the model', () => {
      for (const model of FALLBACK_CATALOG) {
        if (model.effortLevels.length === 0) continue
        const id = `${model.id.replaceAll('.', '-')}-thinking`
        const variantIDs = (registry.get(id)?.variants ?? []).map((variant) => String(variant.id))
        expect(variantIDs).toEqual([...model.effortLevels])
      }
    })

    test('variant budgets map back to the effort level they are named for', () => {
      for (const id of thinkingIDs) {
        const kiroModel = resolveKiroModel(id)
        for (const variant of registry.get(id)?.variants ?? []) {
          const level = String(variant.id) as Effort
          const budget = (variant.settings?.thinkingConfig as { thinkingBudget: number })
            .thinkingBudget
          expect(budget).toBe(THINKING_BUDGETS[level])
          expect(budgetToEffort(budget, kiroModel)).toBe(level)
        }
      }
    })

    test('variants are ordered low to max', () => {
      for (const id of thinkingIDs) {
        const budgets = (registry.get(id)?.variants ?? []).map(
          (variant) =>
            (variant.settings?.thinkingConfig as { thinkingBudget: number }).thinkingBudget
        )
        expect(budgets).toEqual([...budgets].sort((a, b) => a - b))
      }
    })
  })

  test('carries limit and capabilities through to both entries', () => {
    expect(registry.get('claude-opus-5')?.limit).toEqual({ context: 1000000, output: 128000 })
    expect(registry.get('claude-opus-5-thinking')?.limit).toEqual(
      registry.get('claude-opus-5')?.limit
    )
    expect(registry.get('claude-opus-5-thinking')?.capabilities).toEqual(
      registry.get('claude-opus-5')?.capabilities
    )
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
      effortLevels: ['low', 'medium', 'high']
    }
    activateCatalog([unknown])

    const fresh = buildRegistry()
    expect([...fresh.keys()]).toEqual(['claude-fable-6-1', 'claude-fable-6-1-thinking'])
    expect(fresh.get('claude-fable-6-1')?.name).toBe('Claude Fable 6.1 (6.0x)')
    expect(
      (fresh.get('claude-fable-6-1-thinking')?.variants ?? []).map((variant) => String(variant.id))
    ).toEqual(['low', 'medium', 'high'])
  })
})
