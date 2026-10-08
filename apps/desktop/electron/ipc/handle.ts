import { ipcMain } from 'electron'
import type { IpcInvokeChannel, IpcInvokeMap } from '@shared/ipc'

type Handler<C extends IpcInvokeChannel> = (
  event: Electron.IpcMainInvokeEvent,
  ...args: IpcInvokeMap[C]['args']
) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result']

/** Register one typed IPC invoke handler. */
export function handle<C extends IpcInvokeChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, handler as Parameters<typeof ipcMain.handle>[1])
}
