import { describe, expect, test } from 'bun:test'
import { buildUrl, KIRO_CONSTANTS, normalizeRegion } from '../constants.js'

describe('normalizeRegion', () => {
  test('accepts configured AWS regions with the installed Zod enum shape', () => {
    expect(normalizeRegion('us-west-2')).toBe('us-west-2')
  })
})

describe('buildUrl', () => {
  test('substitutes the region into every Kiro endpoint template', () => {
    expect(buildUrl(KIRO_CONSTANTS.AVAILABLE_MODELS_URL, 'eu-central-1')).toBe(
      'https://q.eu-central-1.amazonaws.com/ListAvailableModels'
    )
    expect(buildUrl(KIRO_CONSTANTS.USAGE_LIMITS_URL, 'us-east-1')).toBe(
      'https://q.us-east-1.amazonaws.com/getUsageLimits'
    )
  })
})
