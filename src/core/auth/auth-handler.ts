import { Credential, Integration } from '@opencode/plugin'
import type {
  IntegrationOAuthAuthorization,
  IntegrationOAuthMethod,
  IntegrationOAuthMethodRegistration
} from '@opencode/plugin/promise/integration'
import type { AccountRepository } from '../../infrastructure/database/account-repository.js'
import { RegionSchema } from '../../plugin/config/schema.js'
import * as logger from '../../plugin/logger.js'
import type { ManagedAccount } from '../../plugin/types.js'
import { summarizeUsage } from '../../plugin/usage.js'
import { UsageTracker } from '../account/usage-tracker.js'
import { IdcAuthMethod } from './idc-auth-method.js'
import { TokenRefresher } from './token-refresher.js'

type ToastFunction = (message: string, variant: 'info' | 'warning' | 'success' | 'error') => void

type OAuthForm = NonNullable<IntegrationOAuthMethod['form']>
type OAuthFormField = OAuthForm[number]
type FormAnswer = Parameters<IntegrationOAuthMethodRegistration['authorize']>[0]

const REGION_PATTERN = `^$|^(${RegionSchema.options.join('|')})$`
const START_URL_PATTERN = '^$|^https?://\\S+$'
const PROFILE_ARN_PATTERN = '^$|^arn:aws:(codewhisperer|qdeveloper):[^:]+:\\d{12}:profile/.+$'

const IDC_METHOD_ID = 'iam-identity-center'
const IDC_PROFILE_METHOD_ID = 'iam-identity-center-profile-arn'

/** Translate a form answer into the plain string map the IDC flow expects. */
function toInputs(answer: FormAnswer | undefined): Record<string, string> {
  const inputs: Record<string, string> = {}
  if (!answer) return inputs

  for (const [key, value] of Object.entries(answer)) {
    if (typeof value === 'string') inputs[key] = value
    else if (typeof value === 'number' || typeof value === 'boolean') inputs[key] = String(value)
    else if (Array.isArray(value)) inputs[key] = value.join(',')
  }

  return inputs
}

/** Project a persisted Kiro account onto the credential OpenCode stores. */
function toCredential(methodID: string, account: ManagedAccount): Credential.OAuth {
  return {
    type: 'oauth',
    methodID: Integration.MethodID.make(methodID),
    refresh: account.refreshToken,
    access: account.accessToken,
    expires: Math.trunc(account.expiresAt),
    metadata: {
      email: account.email,
      region: account.region,
      profileArn: account.profileArn
    }
  }
}

export class AuthHandler {
  private accountManager?: any
  private startupUsageFetched = false

  constructor(
    private config: any,
    private repository: AccountRepository
  ) {}

  async initialize(showToast?: ToastFunction): Promise<void> {
    const { syncFromKiroCli } = await import('../../plugin/sync/kiro-cli.js')

    logger.log('Auth init', { autoSyncKiroCli: !!this.config.auto_sync_kiro_cli })
    if (this.config.auto_sync_kiro_cli) {
      logger.log('Kiro CLI sync: start')
      await syncFromKiroCli()
      this.repository.invalidateCache()
      const accounts = await this.repository.findAll()
      if (this.accountManager) {
        for (const a of accounts) this.accountManager.addAccount(a)
      }
      logger.log('Kiro CLI sync: done', { importedAccounts: accounts.length })
    }

    // Refresh usage before the summary toast: the persisted value is stale after
    // the monthly reset until the first request syncs. Backgrounded so it never
    // delays plugin setup, and falls back to the stored value on error.
    void (async () => {
      try {
        await this.refreshUsageFromApi(showToast)
      } catch (e) {
        logger.warn('Startup usage refresh failed', {
          error: e instanceof Error ? e.message : String(e)
        })
      }
      this.logUsageSummary(showToast)
    })()
  }

  async refreshUsageFromApi(showToast?: ToastFunction): Promise<void> {
    if (!this.accountManager || this.config.usage_tracking_enabled === false) return
    if (this.startupUsageFetched) return
    this.startupUsageFetched = true

    const { syncFromKiroCli } = await import('../../plugin/sync/kiro-cli.js')
    const tokenRefresher = new TokenRefresher(
      this.config,
      this.accountManager,
      syncFromKiroCli,
      this.repository
    )
    const usageTracker = new UsageTracker(this.config, this.accountManager, this.repository)
    const toast: ToastFunction = showToast ?? (() => {})

    for (const acc of this.accountManager.getAccounts()) {
      if (!acc.isHealthy) continue
      try {
        const { account: usable } = await tokenRefresher.refreshIfNeeded(
          acc,
          this.accountManager.toAuthDetails(acc),
          toast
        )
        if (!usable.isHealthy) continue
        await usageTracker.syncNow(usable, this.accountManager.toAuthDetails(usable))
      } catch (e) {
        logger.warn('Startup usage fetch failed; keeping stored value', {
          email: acc.email,
          error: e instanceof Error ? e.message : String(e)
        })
      }
    }
  }

  private logUsageSummary(showToast?: ToastFunction): void {
    if (!this.accountManager) return
    const accounts = this.accountManager.getAccounts()
    if (!accounts.length) return

    for (const acc of accounts) {
      const { used, limit, pct } = summarizeUsage(acc.usedCount ?? 0, acc.limitCount ?? 0)
      if (limit > 0) {
        const msg = `Kiro usage (${acc.email}): ${used}/${limit} (${pct}%)`
        logger.log(msg)
        if (showToast) {
          const variant = pct >= 90 ? 'warning' : 'info'
          setTimeout(() => showToast(msg, variant), 3000)
        }
      } else if (used > 0) {
        const msg = `Kiro usage (${acc.email}): ${used} requests used`
        logger.log(msg)
        if (showToast) setTimeout(() => showToast(msg, 'info'), 3000)
      }
    }
  }

  setAccountManager(am: any): void {
    this.accountManager = am
  }

  /**
   * OpenCode V2 integration methods for `opencode`'s connect flow. Each method
   * runs the AWS device-code flow and returns the credential OpenCode stores for
   * the integration.
   */
  getMethods(integrationID: string): IntegrationOAuthMethodRegistration[] {
    if (!this.accountManager) {
      return []
    }

    const idcMethod = new IdcAuthMethod(this.config, this.repository, this.accountManager)

    return [
      {
        integrationID,
        method: {
          id: IDC_METHOD_ID,
          type: 'oauth',
          label: 'AWS Builder ID / IAM Identity Center',
          form: this.buildIdcForm([], false)
        },
        authorize: (answer) => this.runIdcMethod(idcMethod, IDC_METHOD_ID, answer)
      },
      {
        integrationID,
        method: {
          id: IDC_PROFILE_METHOD_ID,
          type: 'oauth',
          label: 'IAM Identity Center with Profile ARN',
          form: this.buildIdcForm(['profile_arn'], true)
        },
        authorize: (answer) => this.runIdcMethod(idcMethod, IDC_PROFILE_METHOD_ID, answer)
      }
    ]
  }

  private async runIdcMethod(
    method: IdcAuthMethod,
    methodID: string,
    answer: FormAnswer | undefined
  ): Promise<IntegrationOAuthAuthorization> {
    const result = await method.authorize(toInputs(answer))

    return {
      url: result.url,
      instructions: result.instructions,
      mode: 'auto',
      callback: result.complete().then((account) => toCredential(methodID, account))
    }
  }

  /**
   * Build the connect form. The profile ARN field is only part of the second
   * method, so callers choose whether to include it.
   */
  private buildIdcForm(extraKeys: string[], profileArnRequired: boolean): OAuthForm {
    const configStartUrl = this.config.idc_start_url
    const configRegion = this.config.idc_region
    const configProfileArn = this.config.idc_profile_arn

    const fields: [OAuthFormField, ...OAuthFormField[]] = [
      {
        type: 'string',
        key: 'start_url',
        title: 'IAM Identity Center Start URL',
        description: configStartUrl
          ? `Current: ${configStartUrl}. Leave blank to keep it.`
          : 'Leave blank to use AWS Builder ID.',
        placeholder: 'https://your-company.awsapps.com/start',
        pattern: START_URL_PATTERN
      },
      {
        type: 'string',
        key: 'idc_region',
        title: 'IAM Identity Center region (sso_region)',
        description:
          configRegion && configRegion !== 'us-east-1'
            ? `Current: ${configRegion}. Leave blank to keep it.`
            : 'Leave blank for us-east-1.',
        placeholder: 'us-east-1',
        pattern: REGION_PATTERN
      }
    ]

    if (extraKeys.includes('profile_arn')) {
      fields.push({
        type: 'string',
        key: 'profile_arn',
        title: 'Profile ARN',
        description: configProfileArn
          ? `Current: ${configProfileArn}. Leave blank to keep it.`
          : 'CodeWhisperer or Q Developer profile ARN.',
        placeholder: 'arn:aws:codewhisperer:us-east-1:123456789012:profile/XXXXXXXXXX',
        required: profileArnRequired && !configProfileArn,
        pattern: PROFILE_ARN_PATTERN
      })
    }

    return fields
  }
}
