import { createContextBudgetRuntime } from '../../runtime/pi/context-budget'
import { log } from '../debug-log'

export { syncContextBudget } from '../../runtime/pi/context-budget'

// One desktop instance shared by startup, IPC and routines, as before.
export const { enforceContextBudget, watchContextBudget, withBudgetCompaction } =
  createContextBudgetRuntime(log)
