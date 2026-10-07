import { describe, expect, it } from 'vitest'
import {
  buildAttachmentBlock,
  composePrompt,
  formatFileSize,
  isInlineableImage,
  toImageContents,
  type PendingAttachment,
} from './attachments'

const image = (name = 'a.png'): PendingAttachment => ({
  kind: 'image',
  data: 'BASE64',
  mimeType: 'image/png',
  name,
})
const file = (path: string, name = 'spec.pdf'): PendingAttachment => ({
  kind: 'file',
  path,
  name,
  size: 2048,
})

describe('isInlineableImage', () => {
  it('accepts exactly the MIME types pi supports', () => {
    for (const m of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp']) {
      expect(isInlineableImage(m)).toBe(true)
    }
  })

  it('rejects PDFs and other documents — pi has no document content type', () => {
    expect(isInlineableImage('application/pdf')).toBe(false)
    expect(isInlineableImage('text/plain')).toBe(false)
    // SVG is an image to the browser but not to pi's sniffer.
    expect(isInlineableImage('image/svg+xml')).toBe(false)
  })
})

describe('buildAttachmentBlock', () => {
  it('is empty when there are no file attachments', () => {
    expect(buildAttachmentBlock([])).toBe('')
    expect(buildAttachmentBlock([image()])).toBe('')
  })

  it('lists one absolute path per line inside a named block', () => {
    const block = buildAttachmentBlock([file('/tmp/a.pdf'), file('/tmp/b.csv', 'b.csv')])
    expect(block).toBe('\n\n<attached-files>\n/tmp/a.pdf\n/tmp/b.csv\n</attached-files>')
  })

  it('ignores images when building the block', () => {
    const block = buildAttachmentBlock([image(), file('/tmp/only.pdf')])
    expect(block).toContain('/tmp/only.pdf')
    expect(block).not.toContain('BASE64')
  })

  it('keeps paths verbatim, including spaces', () => {
    // The agent gets the real path; quoting is its problem, mangling is ours.
    expect(buildAttachmentBlock([file('/tmp/my docs/spec v2.pdf')])).toContain(
      '/tmp/my docs/spec v2.pdf',
    )
  })
})

describe('composePrompt', () => {
  it('returns the text unchanged when nothing is attached', () => {
    expect(composePrompt('summarize this', [])).toBe('summarize this')
  })

  it('appends the block after the user text', () => {
    const prompt = composePrompt('summarize this', [file('/tmp/a.pdf')])
    expect(prompt.startsWith('summarize this')).toBe(true)
    expect(prompt).toContain('<attached-files>')
    expect(prompt).toContain('/tmp/a.pdf')
  })
})

describe('toImageContents', () => {
  it('maps only images, into pi ImageContent shape', () => {
    const contents = toImageContents([image(), file('/tmp/a.pdf')])
    expect(contents).toEqual([{ type: 'image', data: 'BASE64', mimeType: 'image/png' }])
  })
})

describe('formatFileSize', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 KB'],
    [1024 * 1024 * 3, '3.0 MB'],
  ])('formats %d as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected)
  })
})
