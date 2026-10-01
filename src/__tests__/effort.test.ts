import { afterEach, describe, expect, test } from 'bun:test'
import {
  budgetToEffort,
  getEffectiveEffort,
  resolveEffort,
  supportsEffort
} from '../plugin/effort.js'
import { activateCatalog, FALLBACK_CATALOG } from '../plugin/model-catalog.js'

afterEach(() => activateCatalog(FALLBACK_CATALOG))

describe('effort module', () => {
  describe('supportsEffort', () => {
    test('returns true for models Kiro gives an effort schema', () => {
      expect(supportsEffort('claude-opus-4.8')).toBe(true)
      expect(supportsEffort('claude-opus-4.7')).toBe(true)
      expect(supportsEffort('claude-sonnet-4.6')).toBe(true)
      expect(supportsEffort('claude-sonnet-4.6-1m')).toBe(true)
      expect(supportsEffort('claude-sonnet-5')).toBe(true)
      expect(supportsEffort('claude-sonnet-5-1m')).toBe(true)
      expect(supportsEffort('claude-opus-5')).toBe(true)
    })

    test('returns false for models Kiro gives none', () => {
      expect(supportsEffort('claude-haiku-4.5')).toBe(false)
      expect(supportsEffort('claude-opus-4.5')).toBe(false)
      expect(supportsEffort('gpt-5.6-sol')).toBe(false)
      expect(supportsEffort('unknown-model')).toBe(false)
    })

    // Capability follows the catalog, so a model Kiro adds later needs no code change.
    test('follows the catalog rather than a hardcoded list', () => {
      activateCatalog([
        {
          id: 'claude-fable-6.1',
          name: 'Claude Fable 6.1',
          rate: 6,
          limit: { context: 1000000, output: 128000 },
          input: ['text'],
          effortLevels: ['low', 'high']
        }
      ])

      expect(supportsEffort('claude-fable-6.1')).toBe(true)
      expect(resolveEffort('claude-fable-6.1', 'max')).toBe('high')
      expect(supportsEffort('claude-opus-5')).toBe(false)
    })
  })

  describe('resolveEffort', () => {
    test('returns undefined for unsupported models', () => {
      expect(resolveEffort('claude-haiku-4.5', 'max')).toBeUndefined()
    })

    test('returns effort as-is for supported levels', () => {
      expect(resolveEffort('claude-opus-4.8', 'low')).toBe('low')
      expect(resolveEffort('claude-opus-4.8', 'max')).toBe('max')
      expect(resolveEffort('claude-opus-4.8', 'xhigh')).toBe('xhigh')
      expect(resolveEffort('claude-opus-5', 'xhigh')).toBe('xhigh')
      expect(resolveEffort('claude-opus-5', 'max')).toBe('max')
      expect(resolveEffort('claude-sonnet-5-1m', 'xhigh')).toBe('xhigh')
    })

    test('clamps a rejected level to the deepest one the model accepts', () => {
      expect(resolveEffort('claude-sonnet-4.6', 'xhigh')).toBe('max')
      expect(resolveEffort('claude-opus-4.6', 'xhigh')).toBe('max')
    })
  })

  describe('budgetToEffort', () => {
    test('returns undefined for unsupported models', () => {
      expect(budgetToEffort(100000, 'claude-haiku-4.5')).toBeUndefined()
    })

    test('maps reference budgets to their effort level', () => {
      expect(budgetToEffort(16384, 'claude-opus-4.8')).toBe('low')
      expect(budgetToEffort(32768, 'claude-opus-4.8')).toBe('medium')
      expect(budgetToEffort(65536, 'claude-opus-4.8')).toBe('high')
      expect(budgetToEffort(98304, 'claude-opus-4.8')).toBe('xhigh')
      expect(budgetToEffort(128000, 'claude-opus-4.8')).toBe('max')
    })

    test('maps sub-band and over-ceiling budgets', () => {
      expect(budgetToEffort(1024, 'claude-opus-4.8')).toBe('low')
      expect(budgetToEffort(20000, 'claude-opus-4.8')).toBe('medium')
      expect(budgetToEffort(200000, 'claude-opus-4.8')).toBe('max')
    })

    test('reaches xhigh on every xhigh-capable model', () => {
      expect(budgetToEffort(98304, 'claude-opus-4.7')).toBe('xhigh')
      expect(budgetToEffort(98304, 'claude-opus-5')).toBe('xhigh')
    })

    test('clamps the xhigh band to max for non-xhigh models', () => {
      expect(budgetToEffort(98304, 'claude-sonnet-4.6')).toBe('max')
      expect(budgetToEffort(98304, 'claude-opus-4.6')).toBe('max')
    })
  })

  describe('getEffectiveEffort', () => {
    test('returns undefined for unsupported models', () => {
      expect(getEffectiveEffort('claude-haiku-4.5', true, 100000)).toBeUndefined()
    })

    test('uses explicit config when provided', () => {
      expect(getEffectiveEffort('claude-opus-4.8', true, 20000, 'max')).toBe('max')
      expect(getEffectiveEffort('claude-opus-4.8', false, 20000, 'high')).toBe('high')
    })

    test('returns undefined when not thinking and no config', () => {
      expect(getEffectiveEffort('claude-opus-4.8', false, 20000)).toBeUndefined()
    })

    test('uses budget mapping when thinking and auto-mapping enabled', () => {
      expect(getEffectiveEffort('claude-opus-4.8', true, 128000, undefined, true)).toBe('max')
      expect(getEffectiveEffort('claude-opus-4.8', true, 20000, undefined, true)).toBe('medium')
      expect(getEffectiveEffort('claude-opus-5', true, 98304, undefined, true)).toBe('xhigh')
      expect(getEffectiveEffort('claude-opus-5', true, 32768, undefined, true)).toBe('medium')
      expect(getEffectiveEffort('claude-opus-5', true, 8192, undefined, true)).toBe('low')
    })

    test('falls back to medium when auto-mapping disabled', () => {
      expect(getEffectiveEffort('claude-opus-4.8', true, 128000, undefined, false)).toBe('medium')
    })
  })
})
