import { describe, expect, test } from 'bun:test'
import type { UsageSnapshot } from '../plugin/usage-rpc.js'
import cliPlugin from '../tui.js'

const SNAPSHOT: UsageSnapshot = { used: 1691.37, limit: 2000, pct: 85, accounts: 1 }

function makeContext(get: () => Promise<UsageSnapshot> = async () => SNAPSHOT): {
  context: any
  claimed: string[]
  disposed: string[]
  push: (snapshot: UsageSnapshot) => void
  unsubscribed: () => boolean
} {
  const claimed: string[] = []
  const disposed: string[] = []
  let handler: ((event: { data: UsageSnapshot }) => void) | undefined
  let subscribed = true

  const context = {
    location: { directory: '/home/mickael' },
    data: { location: { default: () => ({ directory: '/fallback' }) } },
    theme: { text: { muted: 'muted', feedback: { warning: { base: 'warning' } } } },
    client: {
      rpc: () => ({
        get,
        events: {
          on: (_name: string, listener: (event: { data: UsageSnapshot }) => void) => {
            handler = listener
            return () => {
              subscribed = false
            }
          }
        }
      })
    },
    ui: {
      slot: ({ append }: { append: string }) => {
        claimed.push(append)
        return () => disposed.push(append)
      }
    }
  }

  return {
    context,
    claimed,
    disposed,
    push: (snapshot) => handler?.({ data: snapshot }),
    unsubscribed: () => !subscribed
  }
}

describe('kiro CLI plugin', () => {
  test('claims the session and home footer status slots', async () => {
    const { context, claimed } = makeContext()

    await cliPlugin.setup(context)

    expect(cliPlugin.id).toBe('kiro.cli')
    expect(claimed).toEqual(['prompt.footer.status', 'home.footer.status'])
  })

  test('releases the slots and the event subscription on cleanup', async () => {
    const { context, disposed, unsubscribed } = makeContext()

    const cleanup = await cliPlugin.setup(context)
    await (cleanup as () => void | Promise<void>)()

    expect(disposed).toEqual(['prompt.footer.status', 'home.footer.status'])
    expect(unsubscribed()).toBe(true)
  })

  // Without the server plugin the RPC rejects; the footer must still come up.
  test('survives an unavailable server plugin', async () => {
    const { context, claimed } = makeContext(async () => {
      throw new Error('RPC is unavailable: kiro.usage')
    })

    await cliPlugin.setup(context)

    expect(claimed).toHaveLength(2)
  })

  test('accepts pushed quota updates', async () => {
    const { context, push } = makeContext()

    await cliPlugin.setup(context)

    expect(() => push({ used: 1900, limit: 2000, pct: 95, accounts: 1 })).not.toThrow()
  })
})
