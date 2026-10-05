import { beforeEach, expect, it, vi } from 'vitest'
import { useFilesStore, workspaceFiles } from '@/stores/files'
import { usePromptStore } from '@/stores/prompt'
import { closeEditorFiles, editorTabLabel, saveAllEditorFiles } from './editorTabActions'
vi.mock('@/lib/monaco', () => ({ languageForPath: () => 'plaintext' }))
vi.mock('./MonacoEditor', () => ({ releaseFileModel: () => {} }))
const invoke = vi.fn().mockResolvedValue({ content: 'disk', size: 4, mtimeMs: 1 })
const store = () => useFilesStore.getState()
const files = () => workspaceFiles(store(), '/repo').openFiles

beforeEach(async () => {
  vi.stubGlobal('window', { phosphor: { invoke } })
  invoke.mockClear()
  useFilesStore.setState({ byWorkspace: {} })
  usePromptStore.setState({ requests: [] })
  for (const path of ['src/a/index.ts', 'src/b/index.ts', 'unique.ts'])
    await store().openFile('/repo', '/repo/' + path)
})

it('uses the shortest distinguishing tab names', () => {
  expect(files().map((file) => editorTabLabel(file, files()))).toEqual([
    'a/index.ts',
    'b/index.ts',
    'unique.ts',
  ])
})

it('reorders tabs without losing their buffers or active path', () => {
  store().updateBuffer('/repo', '/repo/unique.ts', 'unsaved')
  store().moveTab('/repo', '/repo/unique.ts', '/repo/src/a/index.ts')
  expect(files()[0]).toMatchObject({ relativePath: 'unique.ts', content: 'unsaved', dirty: true })
  expect(workspaceFiles(store(), '/repo').activePath).toBe('/repo/unique.ts')
})

it('bulk close skips pinned tabs and stops at Cancel', async () => {
  store().togglePinned('/repo', '/repo/src/a/index.ts')
  store().updateBuffer('/repo', '/repo/src/b/index.ts', 'unsaved')
  const closing = closeEditorFiles(
    '/repo',
    files().map((f) => f.path),
  )
  const request = usePromptStore.getState().requests[0]!
  usePromptStore.getState().dismiss(request, undefined)
  await closing
  expect(files()).toHaveLength(3)
})

it('reopens closed files in most-recent order and keeps histories workspace-local', async () => {
  store().closeFile('/repo', '/repo/unique.ts')
  store().closeFile('/repo', '/repo/src/b/index.ts')
  await store().reopenClosed('/other')
  expect(workspaceFiles(store(), '/other').openFiles).toHaveLength(0)
  await store().reopenClosed('/repo')
  expect(workspaceFiles(store(), '/repo').activePath).toBe('/repo/src/b/index.ts')
  await store().reopenClosed('/repo')
  expect(workspaceFiles(store(), '/repo').activePath).toBe('/repo/unique.ts')
})

it('Save All writes each dirty file but not clean files', async () => {
  store().updateBuffer('/repo', '/repo/src/a/index.ts', 'first')
  store().updateBuffer('/repo', '/repo/unique.ts', 'second')
  await saveAllEditorFiles('/repo')
  expect(
    invoke.mock.calls.filter(([channel]) => channel === 'fs:writeFile').map((args) => args[2]),
  ).toEqual(['first', 'second'])
  expect(files().some((file) => file.dirty)).toBe(false)
})
