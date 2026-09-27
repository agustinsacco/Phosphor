#!/usr/bin/env node
/**
 * Capture the README screenshots against a REAL pi instance.
 *
 *   npm run build && node scripts/capture-live-shots.mjs
 *   ONLY=home,models node scripts/capture-live-shots.mjs      # partial rerun
 *   WORKSPACE=~/myrepo MODEL_EDIT=glm node scripts/capture-live-shots.mjs
 *   REDACT='my-internal-mcp=knowledge' node scripts/capture-live-shots.mjs
 *
 * The shots are published, and a real ~/.pi shows real account details.
 * Every email address on screen is masked before each capture, and REDACT
 * adds `from=to` text replacements for anything else private: an internal
 * MCP server's name or host, say.
 *
 * Unlike capture-readme-shots.mjs (the deterministic stub runner, kept for
 * CI-reproducible shots), this drives the built app against the developer's
 * own ~/.pi: real providers, real models, real sessions in the sidebar. It
 * runs two real turns — one small edit task in a git WORKTREE (so the main
 * checkout is never touched) and one artifact task — so the transcript,
 * diffs, model chips and token costs in the shots are all genuine.
 *
 * The edit session runs on a pi-NATIVE provider (MODEL_EDIT) on purpose: its
 * edits are pi `edit` tool calls, which render as expandable diff cards and
 * feed the Changes pane. A CLI-side provider (pi-claude-cli) executes its own
 * tools and surfaces them as markers, which the Changes pane does not collect
 * — that session instead demonstrates the artifact flow and the composer.
 *
 * What stays isolated: app prefs. PHOSPHOR_TEST_USER_DATA gives the run its own
 * userData dir, so it neither fights the installed app's single-instance
 * lock nor overwrites its settings. pi's side is NOT isolated on purpose —
 * that is the point.
 *
 * Costs and leftovers, deliberately: the two turns and session auto-naming
 * spend real tokens on whatever provider serves them, and the run leaves
 * behind two real sessions plus one worktree/branch under the workspace's
 * .phosphor/worktrees. Delete them like any other session/worktree if unwanted.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { Buffer } from 'node:buffer'
import { statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { _electron as electron } from 'playwright'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Where the shots land and how wide they are. The README reads 1440px PNGs
 * out of docs/img; the landing site (site/) wants the same captures at the
 * display's native scale, so it sets OUT_DIR and MAX_WIDTH=0 (keep the
 * device-scale original).
 */
const outDir = process.env.OUT_DIR ? resolve(process.env.OUT_DIR) : join(repoRoot, 'docs', 'img')
const maxWidth = Number(process.env.MAX_WIDTH ?? 1440)

const workspace = process.env.WORKSPACE ?? join(process.env.HOME ?? '', 'phosphor')
/**
 * The edit task, run on a fresh worktree branch. The git/gh prohibition is
 * load-bearing: an earlier phrasing left the agent free to push its worktree
 * branch and open a real PR on the repo mid-shoot.
 */
const TASK_EDIT =
  process.env.TASK_EDIT ??
  'Tighten the intro paragraph of README.md: keep the meaning, cut filler words, fix any typos. One small edit, no restructuring. Edit the file only — do not run git or gh, do not commit, do not push, do not open a PR.'
/** The artifact task, read-only, run on the checked-out branch. */
const TASK_ARTIFACT =
  process.env.TASK_ARTIFACT ??
  'Create a markdown artifact titled "How Phosphor talks to pi": a one-page explainer of the RPC boundary, based on shared/rpc.ts and the architecture notes in CLAUDE.md. Do not edit any files.'
/**
 * Who serves each session: a provider filter-chip name plus a model search
 * string. Provider-scoped because several catalogues carry the same model
 * names (bedrock, openrouter and the CLI package all offer Claude Fable).
 */
const PROVIDER_EDIT = process.env.PROVIDER_EDIT ?? 'openai-codex'
const MODEL_EDIT = process.env.MODEL_EDIT ?? 'gpt-5.5'
const PROVIDER_ARTIFACT = process.env.PROVIDER_ARTIFACT ?? 'pi-claude-cli'
const MODEL_ARTIFACT = process.env.MODEL_ARTIFACT ?? 'fable'

const only = (process.env.ONLY ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const wanted = (name) => only.length === 0 || only.includes(name)

/** `from=to` pairs, comma-separated, applied to on-screen text before a shot. */
const redactions = (process.env.REDACT ?? '')
  .split(',')
  .map((pair) => pair.split('='))
  .filter(([from, to]) => from && to !== undefined)

const HOME_PROMPT = 'Describe a task or ask a question'
/** A real turn can be minutes; the ceiling is generous, not a target. */
const TURN_TIMEOUT = 600_000

async function main() {
  // Said out loud: a REDACT that never reached the process is otherwise
  // invisible until someone reads the published PNGs.
  console.log(
    `redacting: emails${redactions.map(([from]) => `, "${from}"`).join('')}` +
      (redactions.length ? '' : ' only (set REDACT to mask more)'),
  )
  await mkdir(outDir, { recursive: true })

  const env = { ...process.env, NODE_ENV: 'production' }
  for (const key of [
    'ELECTRON_RENDERER_URL',
    'NODE_ENV_ELECTRON_VITE',
    'ELECTRON_CLI_ARGS',
    // Never the stub here — a leftover e2e env var would silently fake the run.
    'PHOSPHOR_PI_STUB',
    'PI_CODING_AGENT_DIR',
  ]) {
    delete env[key]
  }
  Object.assign(env, {
    PHOSPHOR_E2E_WORKSPACE: workspace,
    PHOSPHOR_TEST_USER_DATA: '1',
    PHOSPHOR_E2E_SHOW: '1',
  })

  // Same capture mechanics as capture-readme-shots.mjs — see the comments
  // there for why: software compositor, settle-after-switch, resize nudge,
  // capturePage over CDP.
  const app = await electron.launch({ args: [repoRoot, '--disable-gpu'], env })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const shots = []

  const settle = async (p, ms = 2400) => p.waitForTimeout(ms)

  const nudge = (dy) =>
    app.evaluate(({ BrowserWindow }, dy) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      if (!win) return
      if (!win.isVisible()) win.show()
      win.moveTop()
      win.focus()
      const b = win.getBounds()
      win.setBounds({ ...b, height: b.height + dy })
    }, dy)

  const shot = async (name) => {
    if (!wanted(name)) return
    const path = join(outDir, `${name}.png`)
    await nudge(-1)
    await page.waitForTimeout(200)
    await nudge(1)
    await page.waitForTimeout(400)
    // One pass over the page, then an observer that keeps redacting: live
    // surfaces (the context meter's MCP chips) re-render from status pushes,
    // and a one-off pass lost that race between the pass and the capture.
    // Observer callbacks run as microtasks, so they land before the next paint.
    await page.evaluate((pairs) => {
      // Runs in the renderer; globalThis keeps node's lint config honest.
      const { document, NodeFilter, MutationObserver } = globalThis
      const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
      const scrub = (node) => {
        const text = pairs.reduce(
          (acc, [from, to]) => acc.split(from).join(to),
          node.nodeValue.replace(email, 'you@example.com'),
        )
        if (text !== node.nodeValue) node.nodeValue = text
      }
      const scrubTree = (root) => {
        if (root.nodeType === 3) return scrub(root)
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) scrub(node)
      }
      scrubTree(document.body)
      if (globalThis.__shotRedactor) return
      globalThis.__shotRedactor = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === 'characterData') scrub(record.target)
          else record.addedNodes.forEach(scrubTree)
        }
      })
      globalThis.__shotRedactor.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
      })
    }, redactions)
    const dataUrl = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      return win.capturePage().then((image) => image.toDataURL())
    })
    await writeFile(path, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
    if (maxWidth > 0) {
      try {
        execFileSync('sips', ['-Z', String(maxWidth), path, '--out', path], { stdio: 'ignore' })
      } catch {
        // no sips (non-macOS): keep the device-scale original
      }
    }
    shots.push(name)
    console.log(`  ✓ ${name}.png (${Math.round(statSync(path).size / 1024)} KB)`)
  }

  /** A turn is over when the composer's Stop control has come and gone. */
  const runTurn = async () => {
    // exact: a sidebar PR badge's accessible name can contain the word "stop".
    const stop = page.getByLabel('Stop', { exact: true }).first()
    await stop.waitFor({ timeout: 90_000 })
    await stop.waitFor({ state: 'hidden', timeout: TURN_TIMEOUT })
    // Post-turn dust: auto-naming, changes scan, artifact replay.
    await settle(page, 4000)
  }

  /** Pick a model in the HOME composer's menu: provider chip, then search. */
  const pickHomeModel = async (provider, query) => {
    await page.getByTestId('home-model-picker').click()
    await page.getByTestId('model-list').waitFor({ timeout: 20_000 })
    // The menu's provider filter chips (aria-pressed toggles, "name count").
    // A bare name match also hits the home picker itself, whose label names
    // the provider serving its current model.
    const chip = new RegExp(`^${provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\d*$`)
    await page.locator('button[aria-pressed]').filter({ hasText: chip }).first().click()
    await page.getByTestId('model-search').fill(query)
    await settle(page, 800)
    await page.getByTestId('model-row').first().click()
  }

  try {
    // ---- Reach the workspace home.
    const picker = page.getByRole('button', { name: /Open Folder/i })
    const homeComposer = page.getByPlaceholder(HOME_PROMPT)
    await picker.or(homeComposer).first().waitFor({ timeout: 60_000 })
    if (await picker.isVisible()) await picker.click()
    await homeComposer.waitFor({ timeout: 30_000 })
    await page.getByTestId('workspace-chip').waitFor({ timeout: 15_000 })

    // Fresh prefs follow the OS appearance; the gallery is shot dark with one
    // light closer, so pin the theme rather than inherit the developer's OS.
    await page.keyboard.press('ControlOrMeta+Comma')
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Dark', exact: true }).click()
    await page.keyboard.press('Escape')
    await settle(page, 1500)

    // ---- 1. The edit session, in a worktree ("new branch" stays ticked) so
    // the edit lands on a disposable branch, never the checkout the developer
    // is standing on.
    await page.getByRole('checkbox', { name: 'new branch' }).check()
    await pickHomeModel(PROVIDER_EDIT, MODEL_EDIT)
    await homeComposer.fill(TASK_EDIT)
    await page.getByRole('button', { name: /Start session/i }).click()
    console.log('edit session: running…')
    await runTurn()

    // ---- 2. Chat: the last activity run expanded on its edit's diff.
    const summary = page.getByTestId('activity-summary').last()
    await summary.waitFor({ timeout: 30_000 })
    if ((await summary.getAttribute('aria-expanded')) === 'false') await summary.click()
    const editCard = page.getByRole('button', { name: /Edited\s/ }).last()
    if (await editCard.isVisible().catch(() => false)) await editCard.click()
    await settle(page, 3500)
    await shot('chat')

    // ---- 3. Changes: the session's touched files with per-file diff.
    await page.getByTitle(/Changes pane/).click()
    await page.getByText('Files changed').waitFor({ timeout: 15_000 })
    await settle(page, 3500)
    await shot('changes')

    // ---- 4–6. Files pane: right, left, fullscreen — a real tree, a real file.
    await page.getByTitle(/Files pane/).click()
    await settle(page, 3500)
    await page.getByTestId('right-pane').getByRole('button', { name: 'README.md' }).first().click()
    await settle(page, 3000)
    await shot('files')

    await page.getByTitle('Move pane to the left').click()
    await settle(page, 3500)
    await shot('files-left')
    await page.getByTitle('Move pane to the right').click()
    await settle(page, 2500)

    await page.getByTitle('Fullscreen pane').click()
    await settle(page, 3000)
    await shot('files-full')
    await page.getByTitle('Exit fullscreen').click()
    await settle(page, 2500)

    // ---- 7. Terminal: a real shell in the workspace, running a real command.
    await page.getByTitle(/Terminal pane/).click()
    await settle(page, 3500)
    await page.getByTestId('right-pane').click()
    await page.keyboard.type('git log --oneline -6')
    await page.keyboard.press('Enter')
    await settle(page, 2500)
    await shot('terminal')

    // ---- 8. The artifact session, on the subscription-backed provider (its
    // custom pi tools arrive via the MCP handoff — worth showing for real).
    await page.getByRole('button', { name: /^New$/ }).click()
    await homeComposer.waitFor({ timeout: 20_000 })
    await page.getByRole('checkbox', { name: 'new branch' }).uncheck()
    await pickHomeModel(PROVIDER_ARTIFACT, MODEL_ARTIFACT)
    await homeComposer.fill(TASK_ARTIFACT)
    await page.getByRole('button', { name: /Start session/i }).click()
    console.log('artifact session: running…')
    await runTurn()

    // The pane opens itself on the project's first artifact only; on a real
    // workspace that ship has sailed, so open it explicitly.
    const artifactScroll = page.getByTestId('artifact-scroll')
    if (!(await artifactScroll.isVisible().catch(() => false))) {
      await page.getByTitle('Artifacts pane').click()
    }
    await artifactScroll.waitFor({ timeout: 30_000 })
    await artifactScroll.evaluate((el) => (el.scrollTop = 260))
    await settle(page, 2500)
    await shot('artifacts')
    await page.getByTitle('Close pane').click()
    await settle(page, 2000)

    // ---- 9. The composer's bells and whistles, on the artifact session.
    // The model chooser: the full multi-provider catalogue, with the chip
    // naming what actually serves this session.
    const composer = page.getByPlaceholder(/Describe a task…/)
    await page.getByTestId('model-chip').click()
    await page.getByTestId('model-list').waitFor({ timeout: 20_000 })
    await settle(page, 1500)
    await shot('models')
    await page.keyboard.press('Escape')
    await settle(page, 800)

    // The thinking ladder (only rendered when the model has levels to pick).
    const thinkingChip = page.getByTestId('thinking-chip')
    if (await thinkingChip.isVisible().catch(() => false)) {
      await thinkingChip.click()
      await settle(page, 1200)
      await shot('thinking')
      await page.keyboard.press('Escape')
      await settle(page, 800)
    }

    // The context meter popover: live composition of the window, real tokens.
    await page.getByTitle(/^Context: /).click()
    await settle(page, 1800)
    await shot('context')
    await page.keyboard.press('Escape')
    await settle(page, 800)

    // The slash-command menu…
    await composer.click()
    await page.keyboard.type('/')
    await settle(page, 1200)
    await shot('commands')
    await composer.fill('')

    // …and @ file mentions, resolved against the real workspace tree.
    await page.keyboard.type('@')
    await settle(page, 1500)
    await shot('mentions')
    await composer.fill('')
    await page.keyboard.press('Escape')

    // ---- 10. Home: the composer over the real sessions of a real repo.
    await page.getByRole('button', { name: /^New$/ }).click()
    await homeComposer.waitFor({ timeout: 20_000 })
    await settle(page, 2200)
    await shot('home')

    // ---- 11–13. Settings: Appearance, the signed-in providers, connectors.
    await page.keyboard.press('ControlOrMeta+Comma')
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await settle(page)
    await shot('settings')
    await page.getByRole('button', { name: 'Accounts', exact: true }).click()
    await settle(page)
    await shot('accounts')
    await page.getByRole('button', { name: 'MCP Connectors', exact: true }).click()
    await settle(page)
    await shot('connectors')

    // ---- 14. The light theme, on the edit session.
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await page.keyboard.press('Escape')
    // Newest first: the artifact session was started last, so the edit
    // session (the one with a diff worth showing) is the second row.
    await page.getByTestId('session-row').nth(1).click()
    await page.getByPlaceholder(/Describe a task…/).waitFor({ timeout: 20_000 })
    await settle(page, 3500)
    await shot('light')
  } finally {
    console.log(`captured: ${shots.join(', ') || 'none'}`)
    await quit(app)
  }
}

/**
 * Close the app without hanging. The terminal shot leaves a live shell, so
 * quitting asks "Quit Phosphor?" in a native dialog nobody will answer, and
 * `app.close()` waits on it forever (SIGTERM does not get through either).
 * Answer it with "Stop work and quit" instead, so the app's own teardown still
 * runs: shells killed, pi children disposed, watchers closed.
 */
async function quit(app) {
  await app
    .evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
    })
    .catch(() => undefined)
  await app.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
