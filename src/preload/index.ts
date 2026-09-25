import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { AccountSnapshot, AddAccountResult, AppConfig } from '../shared/types'
import type { GaugesApi } from '../renderer/api'

/** Subscribes to a main → renderer push without exposing the raw IpcRendererEvent. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: GaugesApi = {
  getConfig: () => ipcRenderer.invoke(IPC_CHANNELS.getConfig) as Promise<AppConfig>,
  setConfig: (patch) => ipcRenderer.invoke(IPC_CHANNELS.setConfig, patch) as Promise<AppConfig>,
  getSnapshots: () => ipcRenderer.invoke(IPC_CHANNELS.getSnapshots) as Promise<AccountSnapshot[]>,
  addAccount: () => ipcRenderer.invoke(IPC_CHANNELS.addAccount) as Promise<AddAccountResult>,
  removeAccount: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.removeAccount, accountId) as Promise<AppConfig>,
  setActiveAccount: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.setActiveAccount, accountId) as Promise<AppConfig>,
  refreshUsage: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.refreshUsage, accountId) as Promise<void>,
  onSnapshot: (listener) => subscribe<AccountSnapshot>(IPC_CHANNELS.snapshot, listener),
  onConfigChanged: (listener) => subscribe<AppConfig>(IPC_CHANNELS.configChanged, listener)
}

export type { GaugesApi }

contextBridge.exposeInMainWorld('gauges', api)
