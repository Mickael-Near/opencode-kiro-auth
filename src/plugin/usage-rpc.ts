import type { Rpc } from '@opencode/plugin'
import { z } from 'zod'

/**
 * Kiro credit quota, pooled over every account the plugin manages.
 *
 * Kiro bills credits against a monthly allowance rather than tokens against a
 * price, so OpenCode's own cost accounting cannot express it: it multiplies token
 * counts by `Model.Info.cost`, which has no meaningful value here. This snapshot
 * is what the CLI plugin renders instead.
 */
export const UsageSnapshot = z.object({
  /** Credits consumed this period, rounded to two decimals. */
  used: z.number(),
  /** Credit allowance. 0 when Kiro has not reported one. */
  limit: z.number(),
  /** `used` over `limit` as a whole percentage, 0 when the allowance is unknown. */
  pct: z.number(),
  /** Accounts the figures cover. 0 means the plugin manages no account yet. */
  accounts: z.number()
})

export type UsageSnapshot = z.infer<typeof UsageSnapshot>

/**
 * Bridge between the server plugin, which owns the account database, and the CLI
 * plugin, which only renders. Both entrypoints import this definition, so the
 * method name and payload cannot drift apart.
 *
 * `Rpc` is imported as a type only: the CLI process must not pull the server
 * plugin runtime in just to describe a payload.
 */
export const usageRpc = {
  id: 'kiro.usage',
  methods: {
    get: { input: z.object({}), output: UsageSnapshot }
  },
  events: {
    /** Pushed when a request refreshes the quota, so the CLI never polls. */
    updated: { schema: UsageSnapshot }
  }
} as const satisfies Rpc.PortableDefinition
