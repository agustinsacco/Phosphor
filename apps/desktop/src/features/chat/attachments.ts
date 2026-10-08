import type { ImageContent } from '@shared/rpc'
import { bytesToBase64 } from '@/lib/base64'

/**
 * Composer attachments.
 *
 * pi's protocol carries IMAGES ONLY — `UserContentBlock = TextContent |
 * ImageContent`, and pi's own MIME sniffer (dist/utils/mime.js) accepts just
 * jpeg/png/gif/webp/bmp. There is no document or file content type, so a PDF
 * cannot be inlined no matter how it is encoded.
 *
 * Anything that is not a supported image is therefore attached BY PATH: the
 * path is appended to the prompt and the agent opens the file with its own
 * tools (read, bash, or a document skill). That mirrors how pi's own `@file`
 * handling works for non-images, and it means the feature works for any file
 * type rather than just the ones we could convert.
 */

/** MIME types pi will actually accept as an inline image. */
const PI_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'])

export function isInlineableImage(mimeType: string): boolean {
  return PI_IMAGE_MIME.has(mimeType)
}

export interface PendingImage {
  kind: 'image'
  data: string
  mimeType: string
  name: string
  /**
   * Where the bytes were persisted for a saved draft (`userData/drafts/`).
   * In-memory bookkeeping only: it never reaches pi, and an image that has not
   * been saved does not have one. See `src/stores/drafts.ts`.
   */
  blobId?: string
}

export interface PendingFile {
  kind: 'file'
  /** Absolute path — this is what the agent is told to open. */
  path: string
  name: string
  size: number
}

export type PendingAttachment = PendingImage | PendingFile

/** Human-readable size for the attachment chip. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Turn a dropped/picked File into an attachment.
 *
 * Images are read into base64 and travel inline. Everything else needs a real
 * path; when the path is unavailable (a File constructed in JS, or a browser
 * harness with no Electron) the file is rejected rather than silently attached
 * as something the agent cannot open.
 */
export async function toAttachment(
  file: File,
  pathForFile: (file: File) => string,
): Promise<PendingAttachment | null> {
  if (isInlineableImage(file.type)) {
    return {
      kind: 'image',
      data: bytesToBase64(await file.arrayBuffer()),
      mimeType: file.type,
      name: file.name,
    }
  }
  const path = pathForFile(file)
  if (!path) return null
  return { kind: 'file', path, name: file.name, size: file.size }
}

/** Inline image blocks for the RPC `images` field. */
export function toImageContents(attachments: PendingAttachment[]): ImageContent[] {
  return attachments
    .filter((a): a is PendingImage => a.kind === 'image')
    .map((a) => ({ type: 'image', data: a.data, mimeType: a.mimeType }))
}

/**
 * Path block appended to the prompt for non-image attachments.
 *
 * One path per line inside a named block so the agent can spot it
 * unambiguously; returns '' when there are no file attachments so callers can
 * concatenate unconditionally.
 */
export function buildAttachmentBlock(attachments: PendingAttachment[]): string {
  const paths = attachments.filter((a): a is PendingFile => a.kind === 'file').map((a) => a.path)
  if (paths.length === 0) return ''
  return `\n\n<attached-files>\n${paths.join('\n')}\n</attached-files>`
}

/** Full prompt text: what the user typed plus any attached file paths. */
export function composePrompt(text: string, attachments: PendingAttachment[]): string {
  return `${text}${buildAttachmentBlock(attachments)}`
}

/**
 * Rebuild composer attachments from a message's persisted images.
 *
 * The inverse of `toImageContents`, used when a rewind hands a sent message
 * back for editing. pi's protocol keeps no filename for an inline image, so
 * the chip gets a positional one — it is display-only and never reaches pi.
 */
export function fromImageContents(images: ImageContent[]): PendingImage[] {
  return images.map((image, index) => ({
    kind: 'image',
    data: image.data,
    mimeType: image.mimeType,
    name: `image-${index + 1}`,
  }))
}
