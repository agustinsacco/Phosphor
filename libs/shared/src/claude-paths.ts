/**
 * The Claude Code CLI's cwd → project-directory mangling.
 *
 * Lives in `shared/` because both processes need it: the main process derives
 * the real transcript path off it (`electron/pi/pi-paths.ts`), and the renderer
 * shows that path in a session's copyable debug block
 * (`src/lib/sessionDebugInfo.ts`). It is pure string work with no `node:`
 * dependency, so one copy serves both.
 *
 * The renderer used to carry its own half of this rule — the character
 * substitution but not the length cap — with a comment saying the main-process
 * version was authoritative. That made the debug block quietly print a
 * non-existent path for any cwd whose mangled name exceeds 200 characters,
 * which is reachable: these sessions run in worktrees nested under `.claude/`.
 *
 * It is the CLI's rule, not ours. If a future version changes it, the worst
 * case is a lookup that misses, never one that hits the wrong file.
 */

/** Longest project directory name the CLI writes before it truncates. */
const CLAUDE_PROJECT_DIR_MAX_LENGTH = 200

/**
 * The CLI's own string hash — `h * 31 + c` folded to int32, base36 — used
 * only to disambiguate truncated directory names.
 */
function claudeCwdHash(cwd: string): string {
  let hash = 0
  for (let i = 0; i < cwd.length; i++) {
    hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * `/home/u/proj/.claude/wt` → `-home-u-proj--claude-wt`.
 *
 * EVERY non-alphanumeric becomes a dash — not just the separators. The dots
 * matter in practice: worktrees under `.claude/` are where these sessions
 * actually run, and a separators-only rule misses them by one character.
 * Names longer than 200 characters are truncated and given a hash suffix.
 *
 * Transcribed from the CLI's own implementation (2.1.238) and checked against
 * every directory under a real ~/.claude/projects, truncated ones included.
 */
export function claudeProjectDirName(cwd: string): string {
  const mangled = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (mangled.length <= CLAUDE_PROJECT_DIR_MAX_LENGTH) return mangled
  return `${mangled.slice(0, CLAUDE_PROJECT_DIR_MAX_LENGTH)}-${claudeCwdHash(cwd)}`
}
