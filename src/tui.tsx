import { Plugin } from '@opencode/plugin/tui'
import { createSignal, Show } from 'solid-js'
import { formatUsageLabel, isUsageWarning } from './plugin/usage-label.js'
import { type UsageSnapshot, usageRpc } from './plugin/usage-rpc.js'

/**
 * Kiro credit quota in the terminal footer.
 *
 * OpenCode's own spend indicator multiplies token counts by a per-million price,
 * which Kiro does not bill on: it debits credits from a monthly allowance. This
 * plugin renders that allowance instead, reading it from the server plugin over
 * RPC so the account database stays on the server side and the indicator keeps
 * working against a remote server.
 *
 * This file must stay `.tsx`. OpenCode transforms JSX entrypoints itself and, in
 * the same pass, rewrites `solid-js` and OpenTUI imports to the copies its
 * renderer already uses. A hand-written `jsx()` call in a `.ts` file skips that
 * rewrite, resolves a second Solid instance, and fails with "No renderer found".
 */
export default Plugin.define({
  id: 'kiro.cli',
  setup(context) {
    const location = context.location ?? context.data.location.default()
    const usage = context.client.rpc(usageRpc)
    const [snapshot, setSnapshot] = createSignal<UsageSnapshot>()

    const refresh = async () => {
      try {
        setSnapshot(await usage.get({}, { location }))
      } catch {
        // No Kiro server plugin at this location: leave the footer untouched.
      }
    }

    void refresh()
    const stopUpdates = usage.events.on('updated', (event) => {
      setSnapshot(event.data)
    })

    const label = () => formatUsageLabel(snapshot())

    const render = () => (
      <Show when={label()}>
        {(text) => (
          <text
            fg={
              isUsageWarning(snapshot())
                ? context.theme.text.feedback.warning.base
                : context.theme.text.muted
            }
          >
            {text()}
          </text>
        )}
      </Show>
    )

    const claims = [
      context.ui.slot({ append: 'prompt.footer.status', render }),
      context.ui.slot({ append: 'home.footer.status', render })
    ]

    return () => {
      stopUpdates()
      for (const dispose of claims) dispose()
    }
  }
})
