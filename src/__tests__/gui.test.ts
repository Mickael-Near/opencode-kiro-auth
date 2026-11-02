import { describe, expect, mock, test } from 'bun:test'
import type { UsageSnapshot } from '../plugin/usage-rpc.js'

// src/gui.tsx is compiled by vite-plugin-solid for the desktop app. Bun only
// needs the JSX factory to exist, since these tests never mount the views.
mock.module('solid-js/jsx-dev-runtime', () => ({ jsxDEV: () => null, Fragment: null }))

const { default: guiPlugin } = await import('../gui.js')
const { createRoot } = await import('solid-js')

const SNAPSHOT: UsageSnapshot = { used: 1691.37, limit: 2000, pct: 85, accounts: 1 }
const WARNING_SNAPSHOT: UsageSnapshot = { used: 1900, limit: 2000, pct: 95, accounts: 1 }

type Prefs = { composer: boolean; titlebar: boolean; bottom: boolean }

function makeContext(
  prefs: Prefs,
  get: () => Promise<UsageSnapshot> = async () => SNAPSHOT
): {
  context: any
  items: Map<string, any>
  push: (snapshot: UsageSnapshot) => void
  stored: () => Prefs
} {
  const items = new Map<string, any>()
  let handler: ((event: { data: UsageSnapshot }) => void) | undefined
  let value = prefs

  const context = {
    stores: {
      prefs: {
        get value() {
          return value
        },
        set: (next: Prefs) => {
          value = next
        }
      }
    },
    client: {
      rpc: () => ({
        get,
        events: {
          on: (_name: string, listener: (event: { data: UsageSnapshot }) => void) => {
            handler = listener
            return () => {
              handler = undefined
            }
          }
        }
      })
    },
    t: (key: string) => key,
    layout: { settings: mock(() => {}) },
    add: (registry: { id: string }, item: unknown) => {
      items.set(registry.id, item)
      return () => items.delete(registry.id)
    }
  }

  return {
    context,
    items,
    push: (snapshot) => handler?.({ data: snapshot }),
    stored: () => value
  }
}

async function setup(prefs: Prefs, get?: () => Promise<UsageSnapshot>) {
  const harness = makeContext(prefs, get)
  createRoot(() => guiPlugin.setup!(harness.context))
  await Bun.sleep(0)
  return harness
}

const composerView = (items: Map<string, any>) =>
  items.get('composer-pill').show({ session: {}, screen: {} })
const titlebarView = (items: Map<string, any>) => items.get('titlebar-item')()

describe('kiro GUI plugin', () => {
  test('contributes every placement and a settings page', async () => {
    const { items } = await setup({ composer: true, titlebar: false, bottom: false })

    expect([...items.keys()].sort()).toEqual([
      'composer-pill',
      'settings-page',
      'slot',
      'titlebar-item'
    ])
  })

  test('shows the quota only where the user enabled it', async () => {
    const { items } = await setup({ composer: true, titlebar: false, bottom: false })

    expect(composerView(items)).toMatchObject({ label: 'Kiro 1691.37/2000 (85%)' })
    expect(titlebarView(items)).toBeUndefined()
  })

  test('follows a placement switched on in the settings', async () => {
    const { context, items } = await setup({ composer: false, titlebar: false, bottom: false })

    context.stores.prefs.set({ composer: false, titlebar: true, bottom: false })

    expect(composerView(items)).toBeUndefined()
    expect(titlebarView(items)).toMatchObject({ id: 'usage', label: 'Kiro 1691.37/2000 (85%)' })
  })

  test('applies pushed updates and flags a nearly spent allowance', async () => {
    const { items, push } = await setup({ composer: true, titlebar: false, bottom: false })

    push(WARNING_SNAPSHOT)

    expect(composerView(items)).toMatchObject({
      label: 'Kiro 1900/2000 (95%)',
      tone: 'warning',
      icon: 'warning'
    })
  })

  test('opens its settings page from the indicator', async () => {
    const { context, items } = await setup({ composer: true, titlebar: false, bottom: false })

    composerView(items).run()

    expect(context.layout.settings).toHaveBeenCalledWith('kiro')
  })

  // Without the server plugin the RPC rejects; the indicator must stay hidden.
  test('stays hidden while the server plugin is unavailable', async () => {
    const { items } = await setup({ composer: true, titlebar: true, bottom: true }, async () => {
      throw new Error('RPC is unavailable: kiro.usage')
    })

    expect(composerView(items)).toBeUndefined()
    expect(titlebarView(items)).toBeUndefined()
  })
})
