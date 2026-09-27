import { isValidContextBudgetValue } from '@shared/context-budget'

/** The slice of electron-store a migration needs, untyped by AppPrefs. */
export interface RawPrefs {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
}

/**
 * Keys whose stored name changed. The old name is no longer in
 * `DEFAULT_APP_PREFS`, so finding it on disk means an earlier version wrote
 * it: its value moves to the new key (unless that one is already set) and the
 * old key is deleted. Runs once, when `electron/store.ts` opens the store.
 *
 * - `claudeAutocompact` → `contextBudget`: the auto-compact window the Claude
 *   CLI used to apply became the budget pi holds every session to, Claude
 *   Code included (shared/context-budget.ts). Same grammar, same meaning.
 */
export function migrateRenamedPrefs(raw: RawPrefs): void {
  const legacy = raw.get('claudeAutocompact')
  if (legacy === undefined) return
  const value = typeof legacy === 'string' ? legacy.trim() : ''
  // A value the grammar rejects meant the 200k default then, as unset does now.
  if (isValidContextBudgetValue(value) && !raw.get('contextBudget')) {
    raw.set('contextBudget', value)
  }
  raw.delete('claudeAutocompact')
}
