/**
 * The context budget (Settings → Agent → Context budget,
 * `AppPrefs.contextBudget`): how large an interactive session may grow before
 * pi compacts it, the same for every provider, Claude Code included.
 * `electron/pi/context-budget.ts` enforces it when a turn settles; the context
 * meter divides by it.
 *
 * Accepted values: `auto`, `off`, or a token count from 100k to 1M — `k`/`M`
 * suffixes accepted, bare numbers below 100k are thousands (`400` means 400k).
 * Unset means the default. The grammar is the one the Claude-only setting
 * this replaced used, so a value carried over from it
 * (`electron/prefs-migrations.ts`) keeps its meaning.
 */

/** The budget when the setting is unset, or holds something unusable. */
export const DEFAULT_CONTEXT_BUDGET_TOKENS = 200_000

const MIN_TOKENS = 100_000
const MAX_TOKENS = 1_000_000

/** A well-formed budget as a token count, or undefined when it is not one. */
function parseTokens(raw: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(raw.trim())
  if (!m) return undefined
  const n = Number(m[1])
  if (!Number.isFinite(n) || n <= 0) return undefined
  const suffix = (m[2] ?? '').toLowerCase()
  if (suffix === 'k') return Math.round(n * 1_000)
  if (suffix === 'm') return Math.round(n * 1_000_000)
  return n < MIN_TOKENS ? Math.round(n * 1_000) : Math.round(n)
}

/**
 * Format alone is not enough: `77k` is well-formed but below the floor, and
 * would resolve to the default — a number the user typed must never mean
 * something else than what they typed, so the settings field rejects it.
 */
export function isValidContextBudgetValue(raw: string): boolean {
  const lowered = raw.trim().toLowerCase()
  if (lowered === 'auto' || lowered === 'off') return true
  const tokens = parseTokens(raw)
  return tokens !== undefined && tokens >= MIN_TOKENS && tokens <= MAX_TOKENS
}

/**
 * The configured budget as a token count, or null for none (`auto` and `off`
 * both leave every session to pi's own threshold near its window).
 *
 * Unset and invalid both resolve to the default, so a hand-edited or stale
 * value still holds sessions to a known size rather than to none.
 */
export function contextBudgetTokens(raw: string): number | null {
  const lowered = raw.trim().toLowerCase()
  if (lowered === '') return DEFAULT_CONTEXT_BUDGET_TOKENS
  if (lowered === 'auto' || lowered === 'off') return null
  const tokens = parseTokens(raw)
  if (tokens === undefined || tokens < MIN_TOKENS || tokens > MAX_TOKENS) {
    return DEFAULT_CONTEXT_BUDGET_TOKENS
  }
  return tokens
}

/**
 * The budget this session is held to, or null when it keeps only pi's own
 * threshold: no budget is set, the session's ⋮ auto-compaction toggle is off,
 * or its model window is no larger than the budget. pi's threshold
 * (window − reserveTokens) is still armed under a budget and can fire first.
 * The provider plays no part — a Claude Code session is held like any other.
 */
export function sessionContextBudget(session: {
  raw: string
  contextWindow: number | null | undefined
  autoCompactionEnabled: boolean
}): number | null {
  const budget = contextBudgetTokens(session.raw)
  if (budget === null || !session.autoCompactionEnabled) return null
  return (session.contextWindow ?? 0) > budget ? budget : null
}
