import { describe, expect, test } from 'bun:test'
import { mergeAccounts } from '../plugin/storage/locked-operations.js'
import {
  getLoggedOutKiroCliAccountIds,
  getStaleKiroCliAccountIds
} from '../plugin/sync/stale-accounts.js'
import type { ManagedAccount } from '../plugin/types.js'

function account(overrides: Partial<ManagedAccount> = {}): ManagedAccount {
  return {
    id: 'account-id',
    email: 'user@example.com',
    authMethod: 'idc',
    region: 'us-east-1',
    clientId: 'client-current',
    clientSecret: 'secret',
    profileArn: 'arn:aws:codewhisperer:us-east-1:123:profile/current',
    refreshToken: 'refresh',
    accessToken: 'access',
    expiresAt: Date.now() + 3600000,
    rateLimitResetTime: 0,
    isHealthy: true,
    failCount: 0,
    ...overrides
  }
}

describe('Kiro CLI account sync', () => {
  test('healthy CLI credentials recover an account with a previous permanent refresh error', () => {
    const existing = account({
      isHealthy: false,
      failCount: 10,
      unhealthyReason: 'Refresh failed: HTTP_401',
      recoveryTime: Date.now() + 3600000,
      accessToken: 'stale-access'
    })

    const incoming = account({
      accessToken: 'fresh-access',
      isHealthy: true,
      failCount: 0,
      unhealthyReason: undefined,
      recoveryTime: undefined
    })

    const merged = mergeAccounts([existing], [incoming])[0]!

    expect(merged.isHealthy).toBe(true)
    expect(merged.failCount).toBe(0)
    expect(merged.unhealthyReason).toBeUndefined()
    expect(merged.recoveryTime).toBeUndefined()
    expect(merged.accessToken).toBe('fresh-access')
  })

  test('keeps the most recent Kiro usage report, even when it is lower', () => {
    const existing = account({ usedCount: 3281.17, limitCount: 2000, usageSyncedAt: 0 })
    const incoming = account({ usedCount: 12.5, limitCount: 2000, usageSyncedAt: 5000 })

    const merged = mergeAccounts([existing], [incoming])[0]!

    expect(merged.usedCount).toBe(12.5)
    expect(merged.usageSyncedAt).toBe(5000)
  })

  test('keeps stored usage when the incoming write carries an older report', () => {
    const existing = account({ usedCount: 140, limitCount: 2000, usageSyncedAt: 5000 })
    const incoming = account({ usedCount: 120, limitCount: 2000, usageSyncedAt: 4000 })

    const merged = mergeAccounts([existing], [incoming])[0]!

    expect(merged.usedCount).toBe(140)
    expect(merged.usageSyncedAt).toBe(5000)
  })

  test('deactivates stale cached CLI account variants after a successful CLI import', () => {
    const synced = {
      id: 'current-id',
      email: 'user@example.com',
      authMethod: 'idc' as const,
      clientId: 'client-current',
      profileArn: 'arn:aws:codewhisperer:us-east-1:123:profile/current'
    }

    const staleSameProfile = {
      id: 'old-id',
      email: 'user@example.com',
      auth_method: 'idc',
      client_id: 'client-old',
      profile_arn: synced.profileArn,
      last_sync: Date.now() - 1000
    }
    const stalePreviouslySynced = {
      id: 'old-cli-synced-id',
      email: 'old@example.com',
      auth_method: 'idc',
      client_id: 'client-old-2',
      profile_arn: 'arn:aws:codewhisperer:us-east-1:123:profile/old',
      last_sync: Date.now() - 1000
    }
    const manualOtherAccount = {
      id: 'manual-id',
      email: 'other@example.com',
      auth_method: 'desktop',
      client_id: 'manual-client',
      profile_arn: 'arn:aws:codewhisperer:us-east-1:123:profile/manual',
      last_sync: 0
    }

    expect(
      getStaleKiroCliAccountIds(
        [synced, staleSameProfile, stalePreviouslySynced, manualOtherAccount],
        [synced]
      )
    ).toEqual(['old-id', 'old-cli-synced-id'])
  })

  test('forgets a CLI account whose auth method was signed out of Kiro CLI', () => {
    const builderId = { id: 'builder-id', auth_method: 'desktop', last_sync: Date.now() - 1000 }
    const sso = { id: 'sso-id', auth_method: 'idc', last_sync: Date.now() }

    expect(getLoggedOutKiroCliAccountIds([builderId, sso], new Set(['idc']))).toEqual([
      'builder-id'
    ])
  })

  test('forgets every CLI account once Kiro CLI holds no sign-in', () => {
    const builderId = { id: 'builder-id', auth_method: 'desktop', last_sync: 1 }
    const sso = { id: 'sso-id', auth_method: 'idc', last_sync: 1 }

    expect(getLoggedOutKiroCliAccountIds([builderId, sso], new Set())).toEqual([
      'builder-id',
      'sso-id'
    ])
  })

  test('keeps accounts added through /connect, which carry no CLI sync time', () => {
    const connected = { id: 'connected-id', auth_method: 'idc', last_sync: 0 }
    const connectedCamel = { id: 'connected-camel', authMethod: 'desktop' }

    expect(getLoggedOutKiroCliAccountIds([connected, connectedCamel], new Set())).toEqual([])
  })

  test('keeps a CLI account whose sign-in is still in Kiro CLI, even if this import failed', () => {
    const sso = { id: 'sso-id', auth_method: 'idc', last_sync: Date.now() - 86400000 }

    expect(getLoggedOutKiroCliAccountIds([sso], new Set(['idc']))).toEqual([])
  })
})
