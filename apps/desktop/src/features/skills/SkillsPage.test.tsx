// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { SKILL_CATALOG } from '@shared/skillsCatalog'
import { useSkillsStore } from '@/stores/skills'
import { SkillsPage } from './SkillsPage'

vi.mock('@/components/markdown/Markdown', () => ({ Markdown: () => null }))
const container = document.createElement('div')
const root = createRoot(container)
afterEach(() => {
  act(() => root.render(null))
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function render(): Promise<ReturnType<typeof vi.fn>> {
  const invoke = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('phosphor', { invoke })
  vi.spyOn(useSkillsStore.getState(), 'refresh').mockResolvedValue(undefined)
  useSkillsStore.setState({ tab: 'discover', selectedDir: null, byWorkspace: {} })
  await act(async () => root.render(<SkillsPage workspacePath="/repo" />))
  return invoke
}

function button(label: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find(
    (node) => node.getAttribute('aria-label') === label || node.textContent === label,
  )!
}

it('shows evidence limits, filters by outcome, and never installs an external plugin', async () => {
  const invoke = await render()
  expect(container.textContent).toContain('not a measured gain for this skill')
  expect(container.querySelectorAll('article')).toHaveLength(SKILL_CATALOG.length)
  await act(async () => button('Audit & verify').click())
  expect(button('Audit & verify').getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelectorAll('article')).toHaveLength(1)
  expect(container.textContent).toContain('Precision is not reported')
  expect(container.querySelector('[aria-label^="Add "]')).toBeNull()
  await act(async () => button('Read evaluation ↗').click())
  expect(invoke).toHaveBeenCalledWith(
    'app:openExternal',
    expect.stringContaining('trailofbits.com'),
  )
  expect(invoke).not.toHaveBeenCalledWith('skills:install', expect.anything(), expect.anything())
})

it('keeps installation behind review and surfaces failures without pretending success', async () => {
  const invoke = await render()
  const add = button('Add react-best-practices')
  expect(add.closest('details')?.open).toBe(false)
  invoke.mockRejectedValueOnce(new Error('Download failed'))
  await act(async () => add.click())
  expect(invoke).toHaveBeenCalledWith('skills:install', 'vercel-react', 'react-best-practices')
  expect(container.textContent).toContain('Download failed')
  expect(add.disabled).toBe(false)
  invoke.mockResolvedValueOnce(undefined)
  await act(async () => add.click())
  expect(useSkillsStore.getState().refresh).toHaveBeenCalledWith('/repo')
  expect(container.textContent).not.toContain('Download failed')
})

it('keeps every offering pinned and external plugins outside the installer allowlist', () => {
  expect(new Set(SKILL_CATALOG.map((entry) => entry.id)).size).toBe(SKILL_CATALOG.length)
  for (const library of SKILL_CATALOG) {
    expect(library.sha).toMatch(/^[a-f0-9]{40}$/)
    if (library.offering) {
      expect(library.offering.evidenceUrl).toMatch(/^https:\/\//)
      expect(library.offering.caveat).not.toBe('')
      expect(library.skills.length === 0).toBe(!!library.offering.external)
    }
  }
})
