import type { UsageSnapshot } from './usage-rpc.js'

/** Credit usage at or above this percentage is worth highlighting. */
export const USAGE_WARNING_PCT = 90

/**
 * One-line credit summary for the terminal footer.
 *
 * Returns an empty string when there is nothing meaningful to show, which the
 * footer renders as no indicator at all: no account yet, or a snapshot that has
 * not arrived. An account with consumption but no reported allowance shows the
 * bare credit count rather than a misleading `x/0 (0%)`.
 */
export function formatUsageLabel(snapshot: UsageSnapshot | undefined): string {
  if (!snapshot || snapshot.accounts === 0) return ''
  if (snapshot.limit <= 0) return snapshot.used > 0 ? `Kiro ${snapshot.used}` : ''
  return `Kiro ${snapshot.used}/${snapshot.limit} (${snapshot.pct}%)`
}

export function isUsageWarning(snapshot: UsageSnapshot | undefined): boolean {
  return snapshot !== undefined && snapshot.limit > 0 && snapshot.pct >= USAGE_WARNING_PCT
}
