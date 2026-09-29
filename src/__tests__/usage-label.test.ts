import { describe, expect, test } from 'bun:test'
import type { ManagedAccount } from '../plugin/types.js'
import { formatUsageLabel, isUsageWarning } from '../plugin/usage-label.js'
import { aggregateUsage } from '../plugin/usage.js'

function makeAccount(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id: 'acc-1',
    email: 'test@example.com',
    authMethod: 'idc',
    region: 'us-east-1',
    refreshToken: 'r',
    accessToken: 'a',
    expiresAt: 0,
    rateLimitResetTime: 0,
    isHealthy: true,
    failCount: 0,
    ...overrides
  }
}

describe('aggregateUsage', () => {
  test('pools credits across accounts, since rotation spends from all of them', () => {
    expect(
      aggregateUsage([
        makeAccount({ usedCount: 100.456, limitCount: 2000 }),
        makeAccount({ id: 'acc-2', usedCount: 50, limitCount: 1000 })
      ])
    ).toEqual({ used: 150.46, limit: 3000, pct: 5, accounts: 2 })
  })

  test('reports an unknown allowance as zero rather than guessing one', () => {
    expect(aggregateUsage([makeAccount({ usedCount: 12 })])).toEqual({
      used: 12,
      limit: 0,
      pct: 0,
      accounts: 1
    })
  })

  test('reports no accounts when the plugin manages none', () => {
    expect(aggregateUsage([])).toEqual({ used: 0, limit: 0, pct: 0, accounts: 0 })
  })
})

describe('formatUsageLabel', () => {
  test('renders used, allowance, and percentage', () => {
    expect(formatUsageLabel({ used: 1474.3, limit: 2000, pct: 74, accounts: 1 })).toBe(
      'Kiro 1474.3/2000 (74%)'
    )
  })

  test('drops the ratio when Kiro has not reported an allowance', () => {
    expect(formatUsageLabel({ used: 12, limit: 0, pct: 0, accounts: 1 })).toBe('Kiro 12')
  })

  // An empty label is how the footer renders no indicator at all.
  test('renders nothing without a snapshot, an account, or any consumption', () => {
    expect(formatUsageLabel(undefined)).toBe('')
    expect(formatUsageLabel({ used: 0, limit: 0, pct: 0, accounts: 0 })).toBe('')
    expect(formatUsageLabel({ used: 0, limit: 0, pct: 0, accounts: 1 })).toBe('')
  })
})

describe('isUsageWarning', () => {
  test('warns from 90% of the allowance', () => {
    expect(isUsageWarning({ used: 1800, limit: 2000, pct: 90, accounts: 1 })).toBe(true)
    expect(isUsageWarning({ used: 1780, limit: 2000, pct: 89, accounts: 1 })).toBe(false)
  })

  test('never warns on an unknown allowance, where the percentage is meaningless', () => {
    expect(isUsageWarning({ used: 5000, limit: 0, pct: 0, accounts: 1 })).toBe(false)
    expect(isUsageWarning(undefined)).toBe(false)
  })
})
