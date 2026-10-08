import { app } from 'electron'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_DRAFT_BLOB_BYTES } from '@shared/models'

/**
 * Image bytes for unsent composer drafts.
 *
 * The first thing in this repo to write binary data under `userData`. Drafts
 * have to survive a restart, and a pasted screenshot is megabytes of base64 —
 * putting that in electron-store means re-serialising the whole config.json on
 * every debounced keystroke. So the JSON holds a `blobId` and the bytes live
 * in one file each.
 *
 * The directory is resolved LAZILY, exactly like `electron/store.ts`'s
 * electron-store. `app.getPath('userData')` at module scope would run while
 * main.ts is still importing, i.e. before it can redirect userData for E2E —
 * and then a test's pasted images would land in the developer's real profile.
 */

let cachedDir: string | null = null

function draftsDir(): string {
  cachedDir ??= join(app.getPath('userData'), 'drafts')
  return cachedDir
}

/** Only ever our own generated ids: no separators, no traversal. */
const BLOB_ID = /^[a-z0-9-]{8,64}$/

function blobPath(blobId: string): string {
  if (!BLOB_ID.test(blobId)) throw new Error(`invalid draft blob id: ${blobId}`)
  return join(draftsDir(), blobId)
}

export async function writeDraftBlob(blobId: string, base64: string): Promise<void> {
  const path = blobPath(blobId)
  await mkdir(draftsDir(), { recursive: true })
  await writeFile(path, Buffer.from(base64, 'base64'))
}

/** Null rather than a throw: a missing blob means the chip is simply dropped. */
export async function readDraftBlob(blobId: string): Promise<string | null> {
  try {
    return (await readFile(blobPath(blobId))).toString('base64')
  } catch {
    return null
  }
}

export async function deleteDraftBlobs(blobIds: string[]): Promise<void> {
  await Promise.all(
    blobIds.map(async (id) => {
      try {
        await unlink(blobPath(id))
      } catch {
        // Already gone, or never written — either way there is nothing to do.
      }
    }),
  )
}

/** Every blob id currently on disk. */
export async function listDraftBlobs(): Promise<string[]> {
  try {
    return (await readdir(draftsDir())).filter((name) => BLOB_ID.test(name))
  } catch {
    return []
  }
}

/** Total bytes held by draft blobs, for the cap. */
export async function draftBlobBytes(): Promise<number> {
  const ids = await listDraftBlobs()
  const sizes = await Promise.all(
    ids.map(async (id) => {
      try {
        return (await stat(blobPath(id))).size
      } catch {
        return 0
      }
    }),
  )
  return sizes.reduce((sum, size) => sum + size, 0)
}

/** True when one more write of `bytes` would push past the cap. */
export async function wouldExceedBlobCap(bytes: number): Promise<boolean> {
  return (await draftBlobBytes()) + bytes > MAX_DRAFT_BLOB_BYTES
}
