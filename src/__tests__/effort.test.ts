import { afterEach, describe, expect, test } from 'bun:test'
import {
  budgetToEffort,
  parseThinkingRequest,
  resolveEffort,
  resolveModelRequestFields,
  supportsEffort,
  supportsThinkingOff
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
          effortLevels: ['low', 'high'],
          thinkingTypes: ['adaptive']
        }
      ])

      expect(supportsEffort('claude-fable-6.1')).toBe(true)
      expect(resolveEffort('claude-fable-6.1', 'max')).toBe('high')
      expect(supportsThinkingOff('claude-fable-6.1')).toBe(false)
      expect(supportsEffort('claude-opus-5')).toBe(false)
    })
  })

  describe('supportsThinkingOff', () => {
    test('follows the disabled entry of the thinking.type enum', () => {
      expect(supportsThinkingOff('claude-sonnet-4.6')).toBe(true)
      expect(supportsThinkingOff('claude-opus-5')).toBe(true)
      expect(supportsThinkingOff('claude-opus-5.5')).toBe(false)
      expect(supportsThinkingOff('claude-haiku-4.5')).toBe(false)
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

  describe('parseThinkingRequest', () => {
    test('reads no variant as the provider default, not as off', () => {
      expect(parseThinkingRequest('claude-opus-5', {})).toEqual({ kind: 'default' })
    })

    test('reads a zero budget as the off variant', () => {
      const body = { providerOptions: { thinkingConfig: { thinkingBudget: 0 } } }
      expect(parseThinkingRequest('claude-opus-5', body)).toEqual({ kind: 'off' })
    })

    test('reads an effort variant from every budget field OpenCode may use', () => {
      expect(
        parseThinkingRequest('claude-opus-5', {
          providerOptions: { thinkingConfig: { thinkingBudget: 65536 } }
        })
      ).toEqual({ kind: 'on', budget: 65536 })
      expect(
        parseThinkingRequest('claude-opus-5', { thinkingConfig: { thinkingBudget: 16384 } })
      ).toEqual({ kind: 'on', budget: 16384 })
      expect(
        parseThinkingRequest('claude-opus-5', { thinkingConfig: { budget_tokens: 98304 } })
      ).toEqual({ kind: 'on', budget: 98304 })
    })

    // Sessions started on a retired `-thinking` ID keep thinking on.
    test('keeps thinking on for retired -thinking IDs', () => {
      expect(parseThinkingRequest('claude-opus-5-thinking', {})).toEqual({
        kind: 'on',
        budget: 20000
      })
    })
  })

  describe('resolveModelRequestFields', () => {
    test('sends nothing without a variant, so Kiro applies its default', () => {
      expect(resolveModelRequestFields('claude-sonnet-4.6', { kind: 'default' })).toBeUndefined()
      expect(resolveModelRequestFields('claude-opus-5.5', { kind: 'default' })).toBeUndefined()
    })

    test('disables thinking where the model allows it', () => {
      expect(resolveModelRequestFields('claude-sonnet-4.6', { kind: 'off' })).toEqual({
        thinking: { type: 'disabled' }
      })
    })

    // Kiro answers 400 to `disabled` on models that always reason.
    test('sends nothing for off on models that cannot disable thinking', () => {
      expect(resolveModelRequestFields('claude-opus-5.5', { kind: 'off' })).toBeUndefined()
    })

    // Sonnet only streams reasoning events when adaptive is sent with the effort.
    test('turns on adaptive thinking at the selected effort', () => {
      expect(resolveModelRequestFields('claude-sonnet-4.6', { kind: 'on', budget: 65536 })).toEqual(
        { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } }
      )
      expect(resolveModelRequestFields('claude-opus-5.5', { kind: 'on', budget: 98304 })).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'xhigh' }
      })
    })

    test('sends nothing for models without a thinking schema', () => {
      expect(
        resolveModelRequestFields('claude-haiku-4.5', { kind: 'on', budget: 65536 })
      ).toBeUndefined()
      expect(resolveModelRequestFields('gpt-5.6-sol', { kind: 'off' })).toBeUndefined()
    })

    test('lets a configured effort override the variant level and the default', () => {
      expect(
        resolveModelRequestFields('claude-opus-4.8', { kind: 'on', budget: 16384 }, 'max')
      ).toEqual({ thinking: { type: 'adaptive' }, output_config: { effort: 'max' } })
      expect(resolveModelRequestFields('claude-opus-4.8', { kind: 'default' }, 'high')).toEqual({
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' }
      })
    })

    test('never lets a configured effort override an explicit off', () => {
      expect(resolveModelRequestFields('claude-opus-4.8', { kind: 'off' }, 'max')).toEqual({
        thinking: { type: 'disabled' }
      })
    })

    test('falls back to medium when auto-mapping is disabled', () => {
      expect(
        resolveModelRequestFields(
          'claude-opus-4.8',
          { kind: 'on', budget: 128000 },
          undefined,
          false
        )?.output_config
      ).toEqual({ effort: 'medium' })
    })
  })
})
