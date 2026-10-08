import { app } from 'electron'
import { join } from 'node:path'
import { ARTIFACT_STORE_ENV } from '@phosphor/pi-extensions/artifact-store'

/**
 * Where the artifact store lives. Resolved LAZILY, like `drafts-blobs.ts` and
 * `store.ts`: `app.getPath('userData')` at module scope would run before
 * main.ts can redirect userData for E2E, and a test's artifacts would land in
 * the developer's real profile.
 */
let cachedRoot: string | null = null

export function artifactStoreRoot(): string {
  cachedRoot ??= join(app.getPath('userData'), 'artifacts')
  return cachedRoot
}

/** What a spawned pi needs to read other sessions' artifacts. */
export function artifactStoreEnv(): Record<string, string> {
  return { [ARTIFACT_STORE_ENV]: artifactStoreRoot() }
}
