import { isPermanentError } from '../health'

export type SyncedCliAccount = {
  id: string
  email: string
  authMethod: 'idc' | 'desktop'
  clientId?: string
  profileArn?: string
}

export type CliAuthMethod = SyncedCliAccount['authMethod']

/**
 * Accounts imported from Kiro CLI whose sign-in Kiro CLI no longer holds.
 *
 * Only `last_sync` marks an account as CLI-imported, so accounts added through
 * `/connect` are never returned. An auth method still present in Kiro CLI keeps
 * its accounts even when this sync could not import them, so a transient import
 * failure cannot drop a working account.
 */
export function getLoggedOutKiroCliAccountIds(
  accounts: any[],
  cliAuthMethods: ReadonlySet<CliAuthMethod>
): string[] {
  return accounts
    .filter((account) => {
      if (!account?.id) return false
      const lastSync = account.last_sync || account.lastSync || 0
      const authMethod = account.auth_method || account.authMethod
      return lastSync > 0 && !cliAuthMethods.has(authMethod)
    })
    .map((account) => account.id)
}

export const STALE_CLI_ACCOUNT_REASON =
  'InvalidTokenException: Replaced by active Kiro CLI account during sync'

export function getStaleKiroCliAccountIds(
  accounts: any[],
  syncedAccounts: SyncedCliAccount[]
): string[] {
  if (syncedAccounts.length === 0) return []

  const syncedIds = new Set(syncedAccounts.map((acc) => acc.id))

  return accounts
    .filter((account) => {
      if (!account?.id || syncedIds.has(account.id)) return false

      const authMethod = account.auth_method || account.authMethod
      const email = account.email
      const clientId = account.client_id || account.clientId
      const profileArn = account.profile_arn || account.profileArn
      const lastSync = account.last_sync || account.lastSync || 0
      const unhealthyReason = account.unhealthy_reason || account.unhealthyReason

      return syncedAccounts.some((synced) => {
        const sameAuthMethod = authMethod === synced.authMethod
        const sameEmail = !!email && email === synced.email
        const sameClient = !!clientId && clientId === synced.clientId
        const sameProfile = !!profileArn && profileArn === synced.profileArn
        const sameIdentity = sameEmail || sameClient || sameProfile

        if (sameAuthMethod && sameIdentity) return true
        if (sameAuthMethod && lastSync > 0) return true
        return isPermanentError(unhealthyReason) && sameIdentity
      })
    })
    .map((account) => account.id)
}
