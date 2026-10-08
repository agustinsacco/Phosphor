import { describe, it, expect } from 'vitest'
import {
  analyzeCommand,
  approvalOptions,
  focusLines,
  parseCommandApproval,
  toCommandLines,
} from './commandApproval'
import type { ExtensionUIRequest } from '@shared/rpc'

/** The exact prose the permission-gate extension convention emits. */
function gateSelect(command: string): ExtensionUIRequest {
  return {
    type: 'extension_ui_request',
    id: '1',
    method: 'select',
    title: `Dangerous command:\n\n  ${command}\n\nAllow?`,
    options: ['Yes', 'No'],
  }
}

describe('parseCommandApproval', () => {
  it('recovers the command from a gate select dialog', () => {
    const parsed = parseCommandApproval(gateSelect('rm -rf /tmp/build'))
    expect(parsed).toEqual({ command: 'rm -rf /tmp/build', heading: 'Dangerous command' })
  })

  it('keeps a multi-line command intact and dedented', () => {
    const command = 'cat > /tmp/x.sh <<EOF\nrm -rf /tmp/y\nEOF\ncd /tmp && sh x.sh'
    const indented = command
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')
    const parsed = parseCommandApproval({
      type: 'extension_ui_request',
      id: '1',
      method: 'select',
      title: `Dangerous command:\n\n${indented}\n\nAllow?`,
      options: ['Yes', 'No'],
    })
    expect(parsed?.command).toBe(command)
  })

  it('reads a confirm dialog that splits heading and command', () => {
    const parsed = parseCommandApproval({
      type: 'extension_ui_request',
      id: '1',
      method: 'confirm',
      title: 'Dangerous command',
      message: 'sudo rm -rf /var/log\n\nProceed?',
    })
    expect(parsed?.command).toBe('sudo rm -rf /var/log')
  })

  it('declines a select with no recognisable yes and no', () => {
    expect(
      parseCommandApproval({
        type: 'extension_ui_request',
        id: '1',
        method: 'select',
        title: 'Dangerous command:\n\n  rm -rf /tmp\n\nAllow?',
        options: ['Later', 'Maybe'],
      }),
    ).toBeNull()
  })

  it('declines an ordinary select that happens to mention a command', () => {
    expect(
      parseCommandApproval({
        type: 'extension_ui_request',
        id: '1',
        method: 'select',
        title: 'Pick a command to run',
        options: ['Yes', 'No'],
      }),
    ).toBeNull()
  })

  it('declines a dialog whose last line is not a yes/no question', () => {
    expect(
      parseCommandApproval({
        type: 'extension_ui_request',
        id: '1',
        method: 'select',
        title: 'Dangerous command:\n\n  rm -rf /tmp\n\nWhich shell?',
        options: ['Yes', 'No'],
      }),
    ).toBeNull()
  })

  it('ignores methods that cannot be an approval', () => {
    expect(
      parseCommandApproval({
        type: 'extension_ui_request',
        id: '1',
        method: 'input',
        title: 'Dangerous command:\n\n  rm -rf /tmp\n\nAllow?',
      }),
    ).toBeNull()
  })
})

describe('approvalOptions', () => {
  it('maps the gate’s own wording to allow and deny', () => {
    expect(approvalOptions(['Yes', 'No'])).toEqual({ allow: 'Yes', deny: 'No' })
    expect(approvalOptions(['Allow once', 'Block'])).toEqual({
      allow: 'Allow once',
      deny: 'Block',
    })
  })

  it('returns null rather than guessing', () => {
    expect(approvalOptions(['Later', 'Maybe'])).toBeNull()
  })
})

describe('analyzeCommand', () => {
  it('names the risk and points at the matched text', () => {
    const risks = analyzeCommand('rm -rf /tmp/build')
    expect(risks).toHaveLength(1)
    const risk = risks[0]!
    expect(risk.id).toBe('rm-recursive')
    expect(risk.text).toBe('rm -rf')
    expect(risk.context).toBe('command')
    expect('rm -rf /tmp/build'.slice(risk.start, risk.end)).toBe('rm -rf')
  })

  it('marks a match inside a heredoc body as written, not run', () => {
    const command = "cat > s.sh <<'EOF'\nrm -rf /tmp/x\nEOF\necho done"
    const risks = analyzeCommand(command)
    expect(risks).toHaveLength(1)
    expect(risks[0]!.context).toBe('heredoc')
  })

  it('prefers a real command match over the same class inside a heredoc', () => {
    const command = "cat > s.sh <<'EOF'\nrm -rf /tmp/x\nEOF\nrm -rf /tmp/real"
    const risk = analyzeCommand(command)[0]!
    expect(risk.context).toBe('command')
    expect(command.slice(risk.start)).toBe('rm -rf /tmp/real')
  })

  it('marks a quoted match as quoted', () => {
    const risk = analyzeCommand('echo "never run sudo here"')[0]!
    expect(risk.id).toBe('sudo')
    expect(risk.context).toBe('quoted')
  })

  it('reports several risk classes, command matches first', () => {
    const risks = analyzeCommand("cat <<'EOF'\nsudo sh\nEOF\ngit reset --hard HEAD")
    expect(risks.map((r) => r.id)).toEqual(['reset-hard', 'sudo'])
    expect(risks[0]!.context).toBe('command')
    expect(risks[1]!.context).toBe('heredoc')
  })

  it('collapses repeats of one class into a single risk', () => {
    expect(analyzeCommand('rm -rf a && rm -rf b && rm -rf c')).toHaveLength(1)
  })

  it('finds nothing in an ordinary command', () => {
    expect(analyzeCommand('npm run build && npm test')).toEqual([])
  })

  it('does not treat an unterminated heredoc as a command', () => {
    const risks = analyzeCommand("cat > s.sh <<'EOF'\nrm -rf /\n")
    expect(risks[0]!.context).toBe('heredoc')
  })
})

describe('toCommandLines', () => {
  it('splits a line into plain and risky runs', () => {
    const command = 'cd /tmp && rm -rf build'
    const lines = toCommandLines(command, analyzeCommand(command))
    expect(lines).toHaveLength(1)
    expect(lines[0]!.flagged).toBe(true)
    expect(lines[0]!.segments.map((s) => s.text).join('')).toBe(command)
    expect(lines[0]!.segments.find((s) => s.risk)?.text).toBe('rm -rf')
  })

  it('round-trips a multi-line command exactly', () => {
    const command = "cat > s.sh <<'EOF'\nrm -rf /tmp/x\nEOF\nsudo sh s.sh"
    const lines = toCommandLines(command, analyzeCommand(command))
    expect(lines.map((l) => l.segments.map((s) => s.text).join('')).join('\n')).toBe(command)
    expect(lines.filter((l) => l.flagged).map((l) => l.number)).toEqual([2, 4])
  })

  it('keeps empty lines as one empty segment', () => {
    const lines = toCommandLines('a\n\nb', [])
    expect(lines).toHaveLength(3)
    expect(lines[1]!.segments).toEqual([{ text: '' }])
  })
})

describe('focusLines', () => {
  it('keeps the flagged line with context, plus the first and last', () => {
    const command = Array.from({ length: 20 }, (_, i) =>
      i === 9 ? 'rm -rf /tmp/x' : `echo ${i}`,
    ).join('\n')
    const kept = focusLines(toCommandLines(command, analyzeCommand(command)))
    expect([...kept].sort((a, b) => a - b)).toEqual([1, 8, 9, 10, 11, 12, 20])
  })

  it('keeps just the ends when nothing is flagged', () => {
    const lines = toCommandLines('a\nb\nc\nd', [])
    expect([...focusLines(lines)].sort((a, b) => a - b)).toEqual([1, 4])
  })
})
