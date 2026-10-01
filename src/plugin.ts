import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { Plugin, Provider } from '@opencode/plugin'
import { KIRO_CONSTANTS } from './constants.js'
import { AuthHandler } from './core/auth/auth-handler.js'
import { RequestHandler } from './core/request/request-handler.js'
import { AccountCache } from './infrastructure/database/account-cache.js'
import { AccountRepository } from './infrastructure/database/account-repository.js'
import { AccountManager } from './plugin/accounts.js'
import { loadConfig } from './plugin/config/index.js'
import * as logger from './plugin/logger.js'
import { loadCatalog } from './plugin/model-catalog.js'
import { buildModelRegistry } from './plugin/model-registry.js'
import { peekActiveAuth } from './plugin/token.js'
import { usageRpc } from './plugin/usage-rpc.js'
import { aggregateUsage } from './plugin/usage.js'
import { formatWebSearchResults, kiroWebSearch } from './plugin/web-search.js'

type ToastFunction = (message: string, variant: string) => void

const KIRO_PROVIDER_ID = 'kiro'

// OpenCode resolves the provider runtime from the `aisdk:` prefix, then hands the
// model to `ctx.aisdk.hook("sdk")`. The plugin replaces that SDK with its own
// instance so every Kiro call is served by the in-process request handler.
const KIRO_AISDK_PACKAGE = 'aisdk:@ai-sdk/openai-compatible'

// Register Kiro's server-side web search as a custom tool, when enabled and the
// active account is Pro (has a profileArn). Returns without registering anything
// otherwise so nothing is advertised to the model on free accounts.
//
// The description is adapted from Kiro's own web_search tool spec so the model
// gets the same guidance on when to search and how to attribute results.
const WEB_SEARCH_DESCRIPTION = `Search the web using Kiro's built-in search engine. Returns titles, URLs, snippets, domains, and publish dates for a query. Billed as Kiro credits.

## When to Use
- The user asks for current or up-to-date information (pricing, versions, release notes, recent events, library APIs).
- Verifying facts that may have changed recently, or details likely newer than the model's training data.
- Looking up specifics of a library, framework, or tool that can't be reliably inferred from the codebase or context.

## When NOT to Use
- Basic concepts, historical facts, or well-established programming syntax the model already knows.
- Anything answerable from the current repository, files, or conversation. Search the codebase first.

## Query Tips
- Keep queries focused; the query MUST be 200 characters or fewer (longer queries are rejected).
- Rephrase the user's request into effective keywords. Run multiple focused searches for complex questions rather than one broad query.
- The snippets often contain enough to answer directly; only fetch a full page (via a separate fetch tool) when you need more detail.

## Using Results & Attribution
- Prioritize the most recently published, authoritative sources (prefer official docs over blogs; use the domain to judge authority).
- ALWAYS cite sources with inline links in the format [description](url).
- Paraphrase and summarize; do not reproduce more than ~30 consecutive words verbatim from any single source. Preserve factual accuracy while condensing.`

const WEB_SEARCH_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'The search query. Must be 200 characters or fewer.'
    }
  },
  required: ['query'],
  additionalProperties: false
}

/**
 * Build the OpenCode V2 plugin definition for a Kiro provider.
 *
 * The provider and its models are registered with provider transforms, the AWS
 * device-code flow is exposed as an integration, and model requests are served
 * by an AI SDK provider whose `fetch` is the Kiro request handler.
 */
export const createKiroPlugin = (id: string): Plugin.Plugin => ({
  id,
  async setup(ctx) {
    const config = loadConfig(ctx.location.directory)

    // V1 raised toasts through the terminal client, which the V2 plugin context
    // no longer exposes. Keep the same call sites, but record them in the plugin
    // log instead of dropping them silently.
    const showToast: ToastFunction = (message, variant) => {
      logger.log(`[${variant}] ${message}`)
    }

    const cache = new AccountCache(60000)
    const repository = new AccountRepository(cache)

    const authHandler = new AuthHandler(config, repository)
    const accountManager = await AccountManager.loadFromDisk(config.account_selection_strategy)
    authHandler.setAccountManager(accountManager)

    const baseURL = KIRO_CONSTANTS.BASE_URL.replace('/generateAssistantResponse', '').replace(
      '{{region}}',
      config.default_region || 'us-east-1'
    )

    const authMethods = authHandler.getMethods(id)

    const reauthenticate = async (): Promise<void> => {
      const registration = authMethods[0]
      if (!registration) {
        throw new Error('Kiro authentication is unavailable')
      }

      const authorization = await registration.authorize({})
      if (authorization.mode !== 'auto') {
        throw new Error('Kiro authentication requires a code exchange')
      }

      await authorization.callback
    }

    const requestHandler = new RequestHandler(accountManager, config, repository, reauthenticate)

    const kiroProvider = createOpenAICompatible({
      name: id,
      baseURL,
      apiKey: '',
      // The option is typed as the global `fetch`, which carries extra Bun-only
      // members; the handler itself only implements the call signature.
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        requestHandler.handle(input, init, showToast)) as unknown as typeof fetch
    })

    try {
      await authHandler.initialize(showToast)
    } catch (e) {
      logger.error('Auth init failed', e instanceof Error ? e : new Error(String(e)))
    }

    // Kiro ships models continuously, so the list is read from the account rather
    // than hardcoded. This has to settle before the provider transform below,
    // which is the only point OpenCode reads the model registry.
    await loadCatalog(() => peekActiveAuth(accountManager))

    if (authMethods.length > 0) {
      await ctx.integration.transform((editor) => {
        editor.update(id, (integration) => {
          integration.name = 'Kiro'
        })
        for (const registration of authMethods) {
          editor.method.update(registration)
        }
      })
    }

    await ctx.provider.transform((editor) => {
      editor.add({
        info: {
          ...Provider.Info.empty(Provider.ID.make(id)),
          name: 'Kiro',
          // Kiro credentials are synced and refreshed inside the plugin, so the
          // provider must not wait for a stored OpenCode connection.
          activation: 'enabled',
          package: KIRO_AISDK_PACKAGE,
          settings: { baseURL }
        },
        models: buildModelRegistry(id)
      })
    })

    await ctx.aisdk.hook('sdk', (event) => {
      if (event.model.providerID !== id) return
      event.sdk = kiroProvider
    })

    await ctx.aisdk.hook('language', (event) => {
      if (event.model.providerID !== id) return
      event.language = event.sdk.languageModel(String(event.model.modelID ?? event.model.id))
    })

    // The CLI plugin has no access to the account database, and OpenCode's own
    // cost accounting cannot express credits against an allowance, so the quota
    // is published over RPC for the footer indicator to read.
    const usage = await ctx.rpc.register(usageRpc, {
      get: async () => aggregateUsage(accountManager.getAccounts())
    })

    requestHandler.onUsageChange(() => {
      void usage.events
        .emit('updated', aggregateUsage(accountManager.getAccounts()))
        .catch((e) =>
          logger.debug(`Usage event emit failed: ${e instanceof Error ? e.message : String(e)}`)
        )
    })

    const account = accountManager.peekCurrentOrNext()
    if (config.web_search_enabled && account?.profileArn) {
      await ctx.tool.transform((editor) => {
        editor.add({
          name: 'kiro_web_search',
          description: WEB_SEARCH_DESCRIPTION,
          input: WEB_SEARCH_INPUT_SCHEMA,
          execute: async (input: unknown) => {
            const { query } = input as { query: string }
            try {
              const results = await kiroWebSearch(accountManager, query)
              return { content: formatWebSearchResults(results) }
            } catch (e) {
              return { content: `Web search failed: ${e instanceof Error ? e.message : String(e)}` }
            }
          }
        })
      })
    }
  }
})

export const KiroOAuthPlugin = createKiroPlugin(KIRO_PROVIDER_ID)
