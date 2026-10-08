/**
 * ANSI handling, shared by both processes.
 *
 * The renderer needs it for text pi extensions hand us (status lines, widget
 * lines, notifications): extensions style their output for pi's own TUI with
 * SGR escape codes, and outside a terminal those bytes must never reach the
 * DOM raw. The main process needs it to read pi's `/login` TUI back off a pty.
 *
 * Two levels of fidelity:
 * - `stripAnsi` removes every escape sequence — for surfaces where color is
 *   noise (toasts, dialog titles) and for scraping a pty screen as text.
 * - `ansiToSpans` honors foreground SGR colors as styled runs — for the
 *   status strip and composer widgets, where extensions use color to mean
 *   something (e.g. green = connected).
 *
 * Lives in `shared/` because `electron/pi/login-flow.ts` used to carry its own
 * narrower `stripAnsi` (CSI + terminated-OSC only, no two-byte escapes). Two
 * strippers with different coverage is how a sequence one of them missed
 * reaches the DOM.
 */

export interface AnsiSpan {
  text: string
  /** CSS color, present only while an SGR foreground color is active. */
  color?: string
}

/**
 * Every escape sequence we might see in extension text: CSI (ESC[ … final
 * byte), OSC (ESC] … BEL or ST), and single-shift/two-byte escapes.
 */
const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;:?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g

/** CSI sequences whose final byte is `m` (SGR) — the only ones we interpret. */
// eslint-disable-next-line no-control-regex
const SGR_PATTERN = /\x1b\[([0-9;:]*)m/

/** Foreground palette for the basic 16 colors (tempered xterm values). */
const BASIC_FG: Record<number, string> = {
  30: '#666666',
  31: '#cd3131',
  32: '#0dbc79',
  33: '#b5a000',
  34: '#2472c8',
  35: '#bc3fbc',
  36: '#11a8cd',
  37: '#a0a0a0',
  90: '#7a7a7a',
  91: '#f14c4c',
  92: '#23d18b',
  93: '#c8c832',
  94: '#3b8eea',
  95: '#d670d6',
  96: '#29b8db',
  97: '#c0c0c0',
}

/** Remove every ANSI escape sequence, leaving plain text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

/** xterm 256-color index → CSS color. */
function color256(n: number): string | undefined {
  if (n < 0 || n > 255) return undefined
  if (n < 16) return BASIC_FG[n < 8 ? 30 + n : 90 + (n - 8)]
  if (n < 232) {
    const steps = [0, 95, 135, 175, 215, 255]
    const i = n - 16
    const r = steps[Math.floor(i / 36)]
    const g = steps[Math.floor(i / 6) % 6]
    const b = steps[i % 6]
    return `rgb(${r},${g},${b})`
  }
  const gray = 8 + (n - 232) * 10
  return `rgb(${gray},${gray},${gray})`
}

/**
 * Split text into runs of a single foreground color. Non-SGR escapes are
 * dropped; SGR attributes other than fg color (bold, bg, …) are ignored.
 */
export function ansiToSpans(text: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  let color: string | undefined
  let rest = text

  const push = (chunk: string): void => {
    if (!chunk) return
    const last = spans[spans.length - 1]
    if (last && last.color === color) {
      last.text += chunk
    } else {
      spans.push(color ? { text: chunk, color } : { text: chunk })
    }
  }

  while (rest.length > 0) {
    const match = ANSI_PATTERN.exec(rest)
    ANSI_PATTERN.lastIndex = 0
    if (!match) {
      push(rest)
      break
    }
    push(rest.slice(0, match.index))
    const sgr = SGR_PATTERN.exec(match[0])
    if (sgr) {
      color = applySgr(sgr[1] ?? '', color)
    }
    rest = rest.slice(match.index + match[0].length)
  }
  return spans
}

/** Fold one SGR parameter list into the active foreground color. */
function applySgr(params: string, current: string | undefined): string | undefined {
  // Colon sub-parameters (rare, e.g. 38:2::r:g:b) normalize to semicolons.
  const codes = params.split(/[;:]/).map((p) => (p === '' ? 0 : Number.parseInt(p, 10)))
  let color = current
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    if (code === undefined || Number.isNaN(code)) continue
    if (code === 0 || code === 39) {
      color = undefined
    } else if (BASIC_FG[code]) {
      color = BASIC_FG[code]
    } else if (code === 38) {
      const mode = codes[i + 1]
      if (mode === 2 && codes.length > i + 4) {
        color = `rgb(${codes[i + 2] ?? 0},${codes[i + 3] ?? 0},${codes[i + 4] ?? 0})`
        i += 4
      } else if (mode === 5 && codes.length > i + 2) {
        color = color256(codes[i + 2] ?? -1) ?? color
        i += 2
      }
    }
  }
  return color
}
