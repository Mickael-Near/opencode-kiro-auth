# OpenCode Kiro Auth Plugin

[![npm version](https://img.shields.io/npm/v/@zhafron/opencode-kiro-auth)](https://www.npmjs.com/package/@zhafron/opencode-kiro-auth)
[![npm downloads](https://img.shields.io/npm/dm/@zhafron/opencode-kiro-auth)](https://www.npmjs.com/package/@zhafron/opencode-kiro-auth)
[![license](https://img.shields.io/npm/l/@zhafron/opencode-kiro-auth)](https://www.npmjs.com/package/@zhafron/opencode-kiro-auth)

OpenCode plugin for AWS Kiro (CodeWhisperer) providing access to Claude Sonnet and Haiku
models with substantial trial quotas.

## Features

- **Multiple Auth Methods**: Supports AWS Builder ID (IDC), IAM Identity Center (custom
  Start URL), and Kiro Desktop (CLI-based) authentication.
- **Auto-Sync Kiro CLI**: Automatically imports and synchronizes active sessions from
  your local `kiro-cli` SQLite database.
- **Gradual Context Truncation**: Intelligently prevents error 400 by reducing context
  size dynamically during retries.
- **Intelligent Account Rotation**: Prioritizes multi-account usage based on lowest
  available quota.
- **High-Performance Storage**: Efficient account and usage management using native Bun
  SQLite.
- **Native Thinking Mode**: Streams Kiro's native reasoning to OpenCode's thinking
  block, with the reasoning field declared on every thinking model, so it renders
  without any model configuration.
- **Kiro Effort Mapping**: Maps OpenCode thinking budgets to Kiro's native effort
  levels automatically, across the full `low`–`max` ladder.
- **Credit Quota In The Footer**: A CLI plugin shows the pooled Kiro credit usage
  under the prompt and on the home screen, refreshed as requests land.
- **Automated Recovery**: Exponential backoff for rate limits and automated token
  refresh.

## Installation

Add the plugin to your `opencode.json` or `opencode.jsonc`:

```json
{
  "plugins": ["@zhafron/opencode-kiro-auth"]
}
```

That is the whole configuration. The plugin registers the `kiro` provider and
advertises every model Kiro exposes, including a `-thinking` companion for each
model that supports reasoning effort. Run `/models` to pick one.

Defining `providers.kiro.models` yourself replaces the plugin's registry entirely.
Only do that to rename or restrict models, and see the reasoning flags below if
any of them are `-thinking` models.

### Thinking Effort Configuration

Every effort-capable Claude model gets a `-thinking` companion, already carrying
the reasoning flags and an effort ladder as variants. Nothing to configure: pick a
`-thinking` model and cycle its variants to change reasoning depth.

Each `-thinking` entry declares the compatibility override OpenCode needs in order
to render reasoning:

```json
{
  "compatibility": { "reasoningField": "reasoning_content" }
}
```

`compatibility.reasoningField` tells OpenCode that reasoning arrives in the
non-standard `reasoning_content` delta this plugin emits. If it is missing,
OpenCode silently drops every reasoning chunk and no thinking block appears.

If you override `providers.kiro.models` in your own config, you replace the
plugin's registry wholesale — copy `compatibility.reasoningField` and the
`capabilities` block onto any `-thinking` model you define, or reasoning will
stop rendering.

Reasoning itself comes from the API: Kiro streams `reasoningContentEvent` on
thinking models, and the plugin forwards each one as a `reasoning_content` delta.
Nothing needs to be enabled for that. Models that instead inline reasoning as
`<thinking>` tags in their answer are still handled, via a fallback scraper.

Variants set `settings.thinkingConfig.thinkingBudget`, which the plugin maps to
Kiro's native `effort` field. Bands are scaled to Kiro's real thinking ceiling
(1024-128000 on opus-4.8/opus-5), so every effort level including `xhigh` is
reachable from a budget alone:

| OpenCode budget | Kiro effort |
| --------------- | ----------- |
| `<= 16384` | `low` |
| `<= 32768` | `medium` |
| `<= 65536` | `high` |
| `<= 98304` | `xhigh` |
| `> 98304` | `max` |

`xhigh` is only available on opus-4.7, opus-4.8, opus-5 and sonnet-5. Those models
get a five-variant ladder; the rest get four, and a budget in the `xhigh` band is
clamped to `max`.

Kiro's GPT-5.6 tiers are not advertised. They configure reasoning through
`reasoning.effort` / `reasoning.mode` instead of `output_config.effort`, so they
need a separate request path.

Use `~/.config/opencode/kiro.json` for plugin-wide behavior such as auth sync,
account selection, retry limits, and `auto_effort_mapping`. A top-level `effort`
setting is a global override for all supported models, not a per-model setting.

## Credit quota indicator

The package ships a second entrypoint, a CLI plugin that OpenCode loads into the
terminal alongside the server plugin. It adds one line to the footer, under the
prompt and on the home screen:

```
Kiro 1691.37/2000 (85%)
```

The figures are the credits pooled across every account the plugin manages, turning
amber from 90% of the allowance. The server plugin publishes them over RPC and pushes
an update whenever a request refreshes the quota, so the indicator also works when the
terminal talks to a remote OpenCode server. Nothing to configure: listing the package
in `plugins` loads both halves.

This is deliberately not OpenCode's own `$ spent` figure. That one multiplies token
counts by a per-million price, and Kiro does not bill that way — it debits credits from
a monthly allowance, at a rate that depends on the model (Opus costs 2.2x a base
request). Any dollar amount here would be an invented Anthropic list price rather than
your Kiro consumption, so the plugin reports the credits instead.

## Setup

1. **Authentication via Kiro CLI (Recommended)**:
   - Perform login directly in your terminal using `kiro-cli login`.
   - On startup the plugin syncs your active session from the Kiro CLI database,
     so there is nothing to paste into OpenCode.
   - For AWS IAM Identity Center (SSO/IDC), the plugin imports both the token and device
     registration (OIDC client credentials) from the `kiro-cli` database.
2. **Interactive login**:
   - Run `/connect` and choose **Kiro**.
   - Pick a login method:
     - **AWS Builder ID / IAM Identity Center** — leave the Start URL blank to sign in
       with **AWS Builder ID**, or enter your company's Start URL (e.g.
       `https://your-company.awsapps.com/start`) to use **IAM Identity Center (SSO)**.
     - **IAM Identity Center with Profile ARN** — the same fields plus a profile ARN.
   - Leaving a form field blank keeps the value already set in
     `~/.config/opencode/kiro.json`.
   - A browser window opens directly to AWS' verification URL (no local auth
     server). If it doesn't, copy/paste the URL and enter the code printed by OpenCode.
   - For **IAM Identity Center**, you may also need a **profile ARN** (`profileArn`).
     - If `kiro-cli` is installed and you've selected a profile once
       (`kiro-cli profile`), the plugin auto-detects it.
     - Otherwise, set `idc_profile_arn` in `~/.config/opencode/kiro.json`.
   - You can also pre-configure defaults in `~/.config/opencode/kiro.json` via
     `idc_start_url` and `idc_region`.
3. Configuration will be automatically managed at `~/.config/opencode/kiro.db`.

## Local plugin development

The simplest way to test local changes is to point OpenCode directly at your local repo
path in `opencode.json` or `opencode.jsonc`:

```json
{
  "plugins": ["/path/to/opencode-kiro-auth"]
}
```

OpenCode loads the local plugin's TypeScript entrypoint directly, so restart (or let the
plugin watcher reload) OpenCode to pick up changes. Run the tests with:

```bash
bun test
```

## Troubleshooting

### Error: Status: 403 (AccessDeniedException / User is not authorized)

If you're using **IAM Identity Center** (a custom Start URL), the Q Developer /
CodeWhisperer APIs typically require a **profile ARN**.

This plugin reads the active profile ARN from your local `kiro-cli` database
(`state.key = api.codewhisperer.profile`) and sends it as `profileArn`.

Fix:

1. Run `kiro-cli profile` and select a profile (e.g. `QDevProfile-us-east-1`).
2. Retry the request (or restart OpenCode so it re-syncs).

### Error: No accounts

This happens when the plugin has no records in `~/.config/opencode/kiro.db`.

1. Ensure `kiro-cli login` succeeds.
2. Ensure `auto_sync_kiro_cli` is `true` in `~/.config/opencode/kiro.json`.
3. Retry the request; the plugin will attempt a Kiro CLI sync when it detects zero
   accounts.

Note for IDC/SSO (OIDC): the plugin may temporarily create an account with a placeholder
email if it cannot fetch the real email during sync (e.g. offline).
It will replace it with the real email once usage/email lookup succeeds.

The plugin supports extensive configuration options.
Edit `~/.config/opencode/kiro.json`:

```json
{
  "auto_sync_kiro_cli": true,
  "account_selection_strategy": "lowest-usage",
  "default_region": "us-east-1",
  "idc_start_url": "https://your-company.awsapps.com/start",
  "idc_region": "us-east-1",
  "rate_limit_retry_delay_ms": 5000,
  "rate_limit_max_retries": 3,
  "max_request_iterations": 20,
  "request_timeout_ms": 120000,
  "token_expiry_buffer_ms": 120000,
  "usage_sync_max_retries": 3,
  "usage_tracking_enabled": true,
  "auto_effort_mapping": true,
  "enable_log_api_request": false
}
```

### Configuration Options

- `auto_sync_kiro_cli`: Automatically sync sessions from Kiro CLI (default: `true`).
- `account_selection_strategy`: Account rotation strategy (`sticky`, `round-robin`,
  `lowest-usage`).
- `default_region`: AWS region (`us-east-1`, `us-west-2`).
- `idc_start_url`: Default IAM Identity Center Start URL (e.g.
  `https://your-company.awsapps.com/start`). Leave unset/blank to default to AWS Builder
  ID.
- `idc_region`: IAM Identity Center (SSO OIDC) region (`sso_region`). Defaults to
  `us-east-1`.
- `rate_limit_retry_delay_ms`: Delay between rate limit retries (1000-60000ms).
- `rate_limit_max_retries`: Maximum retry attempts for rate limits (0-10).
- `max_request_iterations`: Maximum loop iterations to prevent hangs (10-1000).
- `request_timeout_ms`: Request timeout in milliseconds (60000-600000ms).
- `token_expiry_buffer_ms`: Token refresh buffer time (30000-300000ms).
- `usage_sync_max_retries`: Retry attempts for usage sync (0-5).
- `auth_server_port_start`: Legacy/ignored (no local auth server).
- `auth_server_port_range`: Legacy/ignored (no local auth server).
- `usage_tracking_enabled`: Enable usage tracking and the startup usage summary.
- `auto_effort_mapping`: Automatically map OpenCode thinking budgets to Kiro effort
  levels for supported models (default: `true`).
- `enable_log_api_request`: Enable detailed API request logging. Request logs
  include the resolved `additionalModelRequestFields`, so this is how you confirm
  which effort level actually went out on the wire.

## Storage

**Linux/macOS:**

- SQLite Database: `~/.config/opencode/kiro.db`
- Plugin Config: `~/.config/opencode/kiro.json`

**Windows:**

- SQLite Database: `%APPDATA%\opencode\kiro.db`
- Plugin Config: `%APPDATA%\opencode\kiro.json`

## Acknowledgements

Special thanks to [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) for
providing the foundational Kiro authentication logic and request patterns.

## Disclaimer

This plugin is provided strictly for learning and educational purposes.
It is an independent implementation and is not affiliated with, endorsed by, or
supported by Amazon Web Services (AWS) or Anthropic.
Use of this plugin is at your own risk.

Feel free to open a PR to optimize this plugin further.
