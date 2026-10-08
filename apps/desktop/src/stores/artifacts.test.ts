import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeArtifactType, useArtifactsStore } from './artifacts'
import { useLayoutStore } from './layout'

const SESSION = 'session-1'

function create(id: string, overrides: Record<string, unknown> = {}): void {
  useArtifactsStore.getState().ingest(SESSION, 'artifact_create', {
    id,
    title: `Title ${id}`,
    type: 'markdown',
    content: '# hello',
    version: 1,
    ...overrides,
  })
}

/** The shape pi-ext actually emits for an update: sentinel type, id as title. */
function update(id: string, version: number, content = '# hello again'): void {
  useArtifactsStore.getState().ingest(SESSION, 'artifact_update', {
    id,
    title: id,
    type: 'update',
    content,
    version,
  })
}

beforeEach(() => {
  useArtifactsStore.setState({ bySession: {}, selected: {}, selectedVersion: {}, unseen: {} })
  useLayoutStore.setState({ bySession: {} })
})

describe('normalizeArtifactType', () => {
  it('passes through real artifact types', () => {
    expect(normalizeArtifactType('markdown')).toBe('markdown')
    expect(normalizeArtifactType('svg')).toBe('svg')
  })

  it("rejects artifact_update's 'update' sentinel and other junk", () => {
    // This is the bug it exists for: 'update' is a tool name, not a type, so
    // trusting it rendered the code glyph on every completed update card.
    expect(normalizeArtifactType('update')).toBe('code')
    expect(normalizeArtifactType('update', 'markdown')).toBe('markdown')
    expect(normalizeArtifactType(undefined, 'html')).toBe('html')
  })
})

describe('artifacts store — update payloads', () => {
  it('keeps the real title and type across an update whose payload carries neither', () => {
    create('my-doc')
    update('my-doc', 2)
    const artifact = useArtifactsStore.getState().bySession[SESSION]!['my-doc']!
    expect(artifact.title).toBe('Title my-doc')
    expect(artifact.type).toBe('markdown')
    expect(artifact.versions).toHaveLength(2)
  })
})

describe('artifacts store — selection', () => {
  it('does not yank the viewer off the artifact the user is reading', () => {
    useLayoutStore.setState({
      bySession: { [SESSION]: { pane: 'artifacts', expanded: false, side: 'right', size: 45 } },
    })
    create('doc-a')
    create('doc-b')
    useArtifactsStore.getState().select(SESSION, 'doc-a')

    // An unrelated artifact updating mid-turn must not steal the viewer.
    update('doc-b', 2)
    expect(useArtifactsStore.getState().selected[SESSION]).toBe('doc-a')

    // An update to the artifact being viewed is fine to (re-)claim.
    update('doc-a', 2)
    expect(useArtifactsStore.getState().selected[SESSION]).toBe('doc-a')
  })

  it('still selects the newest artifact while the pane is closed', () => {
    create('doc-a')
    useArtifactsStore.getState().select(SESSION, 'doc-a')
    // The first artifact auto-opens the pane; close it again so this covers
    // the genuinely-closed case (selection only decides what opens later).
    useLayoutStore.setState({ bySession: {} })
    create('doc-b')
    expect(useArtifactsStore.getState().selected[SESSION]).toBe('doc-b')
  })

  it('records the version a card navigated to, and clears it on a plain select', () => {
    create('doc-a')
    update('doc-a', 2)
    useArtifactsStore.getState().select(SESSION, 'doc-a', 1)
    expect(useArtifactsStore.getState().selectedVersion[SESSION]).toBe(1)

    useArtifactsStore.getState().select(SESSION, 'doc-a')
    expect(useArtifactsStore.getState().selectedVersion[SESSION]).toBeUndefined()
  })
})
