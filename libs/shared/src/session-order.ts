import type { SessionMeta } from './models'

/**
 * Stable sidebar order: a session's immutable header timestamp, newest first.
 *
 * Resuming, labelling, and receiving a response all update the JSONL file's
 * mtime, so it cannot represent a user-controlled session-list position.
 * Legacy/malformed headers fall back to mtime so those sessions remain listed.
 */
export function compareSessionsByCreation(
  a: Pick<SessionMeta, 'createdAt' | 'mtimeMs'>,
  b: Pick<SessionMeta, 'createdAt' | 'mtimeMs'>,
): number {
  const timestamp = (session: Pick<SessionMeta, 'createdAt' | 'mtimeMs'>): number => {
    const parsed = Date.parse(session.createdAt)
    return Number.isFinite(parsed) ? parsed : session.mtimeMs
  }
  return timestamp(b) - timestamp(a)
}
