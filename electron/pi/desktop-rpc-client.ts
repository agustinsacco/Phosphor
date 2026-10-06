import { PiRpcClient as CorePiRpcClient, type PiSpawnOptions } from './rpc-client'
import { log } from '../debug-log'
import { shutdownApproval } from '../shutdown-approval'

export type { PiSpawnOptions } from './rpc-client'

/** Desktop environment adapter. The RPC transport itself has no Electron dependency. */
export class PiRpcClient extends CorePiRpcClient {
  constructor(options: PiSpawnOptions) {
    super(options, { log, isClosing: () => shutdownApproval.closing })
  }
}
