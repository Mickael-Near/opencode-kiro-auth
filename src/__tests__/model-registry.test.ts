import { describe, expect, test } from 'bun:test'
import { SUPPORTED_MODELS } from '../constants.js'
import type { Effort } from '../plugin/config/schema.js'
import { budgetToEffort, THINKING_BUDGETS } from '../plugin/effort.js'
import { buildModelRegistry } from '../plugin/model-registry.js'
import { resolveKiroModel } from '../plugin/models.js'

const registry = new Map(buildModelRegistry('kiro').map((model) => [model.id as string, model]))

const thinkingIDs = [...registry.keys()].filter((id) => id.endsWith('-thinking'))
const XHIGH_MODELS = [
  'claude-opus-4-7-thinking',
  'claude-opus-4-8-thinking',
  'claude-opus-5-thinking',
  'claude-sonnet-5-thinking'
]

describe('model registry', () => {
  test('every advertised model is resolvable to a Kiro model ID', () => {
    for (const modelID of registry.keys()) {
      expect(SUPPORTED_MODELS).toContain(modelID)
    }
  })

  test('advertises a thinking companion for each effort-capable Claude model', () => {
    expect(thinkingIDs.sort()).toEqual(
      [
        'claude-opus-4-5-thinking',
        'claude-opus-4-6-thinking',
        'claude-opus-4-7-thinking',
        'claude-opus-4-8-thinking',
        'claude-opus-5-thinking',
        'claude-sonnet-4-5-thinking',
        'claude-sonnet-4-6-thinking',
        'claude-sonnet-5-thinking'
      ].sort()
    )
  })

  test('does not advertise Kiro GPT tiers, which use a different reasoning contract', () => {
    for (const id of registry.keys()) {
      expect(id.startsWith('gpt-')).toBe(false)
    }
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
    test('offers xhigh only on models Kiro documents as xhigh-capable', () => {
      for (const id of thinkingIDs) {
        const variantIDs = (registry.get(id)?.variants ?? []).map((variant) => String(variant.id))
        expect(variantIDs.includes('xhigh')).toBe(XHIGH_MODELS.includes(id))
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
    expect(registry.get('claude-opus-5')?.limit).toEqual({ context: 1000000, output: 64000 })
    expect(registry.get('claude-opus-5-thinking')?.limit).toEqual(
      registry.get('claude-opus-5')?.limit
    )
    expect(registry.get('claude-opus-5-thinking')?.capabilities).toEqual(
      registry.get('claude-opus-5')?.capabilities
    )
    expect(registry.get('claude-opus-5')?.capabilities.input).toEqual(['text', 'image', 'pdf'])
  })
})
