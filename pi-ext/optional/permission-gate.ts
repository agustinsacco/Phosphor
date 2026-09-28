/** Opt-in global gate. Copy this file to ~/.pi/agent/extensions/permission-gate.ts.
 * Not loaded by Phosphor. This is a confirmation heuristic, not a shell sandbox.
 */
const ALWAYS_BLOCKED = [/\bshred\b/i, /\btruncate\b/i]
const DANGEROUS_PATTERNS = [
  /\brm\s+(-rf?|-r|--recursive|--force)/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bgit\s+push\s+--force/i,
  /\bgit\s+reset\s+--hard/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\b(chmod|chown)\b.*777/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)/i,
  /\bservice\s+\S+\s+(start|stop|restart)/i,
]

export function permissionDecision(command: string): 'allow' | 'ask' | 'block' {
  if (ALWAYS_BLOCKED.some((pattern) => pattern.test(command))) return 'block'
  if (DANGEROUS_PATTERNS.some((pattern) => pattern.test(command))) return 'ask'
  // AWS authorization belongs to this machine's credentials and IAM policy.
  // No command (including scratch cleanup) exempts the rest of a shell script.
  return 'allow'
}

// Structural types keep this standalone file independent of pi's package name.
interface GateContext {
  hasUI: boolean
  ui: { select(title: string, options: string[]): Promise<string | undefined> }
}
interface GateApi {
  on(
    event: 'tool_call',
    handler: (
      event: { toolName: string; input: { command?: unknown } },
      ctx: GateContext,
    ) => Promise<{ block: true; reason: string } | undefined>,
  ): void
}

export default function permissionGate(pi: GateApi): void {
  pi.on('tool_call', async (event, ctx) => {
    if (event.toolName !== 'bash') return
    const command = event.input.command
    if (typeof command !== 'string') return { block: true, reason: 'Invalid bash command' }
    const decision = permissionDecision(command)
    if (decision === 'block') return { block: true, reason: `Command blocked: ${command}` }
    if (decision === 'allow') return
    if (!ctx.hasUI)
      return { block: true, reason: `Command blocked (no UI for confirmation): ${command}` }
    const choice = await ctx.ui.select(`Dangerous command:\n\n  ${command}\n\nAllow?`, [
      'Yes',
      'No',
    ])
    if (choice !== 'Yes') return { block: true, reason: `Blocked by user: ${command}` }
  })
}
