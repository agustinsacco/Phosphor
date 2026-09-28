/** A session-local window cap. pi still owns every compaction and its reserve. */
interface Model {
  provider: string
  id: string
  contextWindow: number
}
interface Context {
  model?: Model
  isIdle(): boolean
  modelRegistry: { find(provider: string, id: string): Model | undefined }
}
export interface BudgetApi {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void
  setModel?(model: Model): Promise<boolean>
  getThinkingLevel?(): string
  setThinkingLevel?(level: string): void
  registerCommand?(
    name: string,
    command: { description: string; handler(args: string, ctx: Context): Promise<void> },
  ): void
}

export default function contextBudget(pi: BudgetApi): void {
  if (!pi.setModel || !pi.registerCommand) return
  let budget: number | null = null
  let applying = false
  const apply = async (ctx: Context): Promise<void> => {
    if (applying || !ctx.model) return
    // Always restore from the catalogue, never from our previously capped clone.
    const original = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id)
    if (!original) return
    const contextWindow = Math.min(original.contextWindow, budget ?? Infinity)
    if (ctx.model.contextWindow === contextWindow) return
    applying = true
    const thinking = pi.getThinkingLevel?.()
    try {
      // Public API, cloned metadata: no registry mutation or persistent settings.
      if (!(await pi.setModel!({ ...original, contextWindow }))) {
        throw new Error('Could not apply the session context budget.')
      }
    } finally {
      if (thinking !== undefined) pi.setThinkingLevel?.(thinking)
      applying = false
    }
  }
  pi.registerCommand('phosphor-context-budget', {
    description: 'Host control: set the session context window budget without running a model',
    async handler(args, ctx) {
      const value = args === 'off' ? null : Number(args)
      if (
        value !== null &&
        (!Number.isSafeInteger(value) || value < 100_000 || value > 1_000_000)
      ) {
        throw new Error('Invalid session context budget.')
      }
      budget = value
      // setModel emits model_select; the Claude provider retires its warm CLI.
      // Never do that during an API call or while a tool batch is executing.
      if (ctx.isIdle()) await apply(ctx)
    },
  })
  const boundary = (_event: unknown, ctx: unknown): Promise<void> => apply(ctx as Context)
  pi.on('before_agent_start', boundary)
  pi.on('turn_end', boundary)
  pi.on('model_select', boundary)
}
