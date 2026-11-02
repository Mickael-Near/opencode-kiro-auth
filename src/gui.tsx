/** @jsxImportSource solid-js */
import {
  ComposerPill,
  type ComposerPillView,
  createKeyed,
  type IconName,
  Plugin,
  SettingsPage,
  Slot,
  Store,
  TitlebarItem
} from '@opencode/plugin/gui'
import { Schema } from 'effect'
import { createSignal, For, onCleanup, Show } from 'solid-js'
import { formatUsageLabel, isUsageWarning } from './plugin/usage-label.js'
import { usageRpc, type UsageSnapshot } from './plugin/usage-rpc.js'

const PLACEMENTS = ['composer', 'titlebar', 'bottom'] as const

type Placement = (typeof PLACEMENTS)[number]

const Prefs = Schema.Struct({
  composer: Schema.Boolean,
  titlebar: Schema.Boolean,
  bottom: Schema.Boolean
})

const DEFAULT_PREFS: typeof Prefs.Type = { composer: true, titlebar: false, bottom: false }

const SETTINGS_PAGE_ID = 'kiro'
const INDICATOR_ID = 'usage'
const USAGE_ICON: IconName = 'window-analytics'
const WARNING_ICON: IconName = 'warning'

const BOTTOM_STRIP_STYLE = { display: 'flex', padding: '2px 8px' } as const

/**
 * Kiro credit quota in OpenCode Desktop.
 *
 * The desktop app never loads the `./tui` part, so the terminal footer has no
 * counterpart here. This GUI part reads the same `kiro.usage` RPC and renders it
 * wherever the user picks in Settings > Kiro: a composer pill, a titlebar pill,
 * or a strip at the bottom of the window.
 */
export default Plugin.define({
  stores: {
    prefs: Store.global(Prefs, DEFAULT_PREFS)
  },
  i18n: {
    en: {
      'settings.title': 'Kiro',
      'indicator.title': 'Kiro credit usage',
      'placement.composer': 'Above the composer',
      'placement.composer.description': 'A pill next to the todo and background work pills.',
      'placement.titlebar': 'In the titlebar',
      'placement.titlebar.description': 'A pill that stays visible on every screen.',
      'placement.bottom': 'At the bottom of the window',
      'placement.bottom.description': 'A full-width strip above the toasts.'
    },
    fr: {
      'settings.title': 'Kiro',
      'indicator.title': 'Consommation de crédits Kiro',
      'placement.composer': 'Au-dessus du composer',
      'placement.composer.description': 'Une pastille à côté des pastilles todo et tâches de fond.',
      'placement.titlebar': 'Dans la barre de titre',
      'placement.titlebar.description': 'Une pastille visible sur tous les écrans.',
      'placement.bottom': 'En bas de la fenêtre',
      'placement.bottom.description': 'Une bande pleine largeur au-dessus des notifications.'
    }
  },
  setup(ctx) {
    const prefs = ctx.stores.prefs
    const [snapshot, setSnapshot] = createSignal<UsageSnapshot>()

    // `ctx.client` is a new object after the desktop server restarts. Keying on
    // it re-subscribes when the host exposes that change reactively, and
    // otherwise subscribes once, which is what a plain read would do anyway.
    createKeyed(
      () => ctx.client,
      (client) => {
        const abort = new AbortController()
        onCleanup(() => abort.abort())
        const usage = client.rpc(usageRpc)
        usage.get({}, { signal: abort.signal }).then(
          (value) => {
            setSnapshot(value)
          },
          () => {
            // No Kiro server plugin yet: stay hidden until an update arrives.
          }
        )
        usage.events.on(
          'updated',
          (event) => {
            setSnapshot(event.data)
          },
          { signal: abort.signal }
        )
      }
    )

    const label = () => formatUsageLabel(snapshot())
    const warning = () => isUsageWarning(snapshot())
    const shown = (placement: Placement) => prefs.value[placement] && label() !== ''
    const openSettings = () => ctx.layout.settings(SETTINGS_PAGE_ID)

    ctx.add(ComposerPill, {
      id: INDICATOR_ID,
      show: (): ComposerPillView | undefined =>
        shown('composer')
          ? {
              label: label(),
              icon: warning() ? WARNING_ICON : USAGE_ICON,
              tone: warning() ? 'warning' : undefined,
              title: ctx.t('indicator.title'),
              run: openSettings
            }
          : undefined
    })

    ctx.add(TitlebarItem, (): TitlebarItem | undefined =>
      shown('titlebar')
        ? {
            id: INDICATOR_ID,
            label: label(),
            icon: warning() ? WARNING_ICON : USAGE_ICON,
            title: ctx.t('indicator.title'),
            run: openSettings
          }
        : undefined
    )

    ctx.add(Slot, {
      at: 'window.bottom',
      render: () => (
        <Show when={shown('bottom')}>
          <div style={BOTTOM_STRIP_STYLE}>
            <ctx.ui.Tooltip value={ctx.t('indicator.title')}>
              <ctx.ui.Button
                variant="ghost-muted"
                size="small"
                icon={warning() ? WARNING_ICON : USAGE_ICON}
                onClick={openSettings}
              >
                {label()}
              </ctx.ui.Button>
            </ctx.ui.Tooltip>
          </div>
        </Show>
      )
    })

    ctx.add(SettingsPage, {
      id: SETTINGS_PAGE_ID,
      icon: USAGE_ICON,
      get title() {
        return ctx.t('settings.title')
      },
      get entries() {
        return PLACEMENTS.map((placement) => ({
          id: placement,
          title: ctx.t(`placement.${placement}`),
          description: ctx.t(`placement.${placement}.description`)
        }))
      },
      render: () => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
          <For each={PLACEMENTS}>
            {(placement) => (
              <ctx.ui.Switch
                label={ctx.t(`placement.${placement}`)}
                description={ctx.t(`placement.${placement}.description`)}
                checked={prefs.value[placement]}
                onChange={(checked) => prefs.set({ ...prefs.value, [placement]: checked })}
              />
            )}
          </For>
        </div>
      )
    })
  }
})
