/**
 * Single source of truth for IPC channel names shared by main, preload, and renderer.
 */
export const IPC_CHANNELS = {
  /** main → renderer push: an updated AccountSnapshot */
  snapshot: 'gauges:snapshot',
  /** main → renderer push: the AppConfig changed */
  configChanged: 'gauges:config-changed',
  /** renderer → main invoke: returns AppConfig */
  getConfig: 'gauges:get-config',
  /** renderer → main invoke: applies a Partial<AppConfig>, returns AppConfig */
  setConfig: 'gauges:set-config',
  /** renderer → main invoke: returns every current AccountSnapshot */
  getSnapshots: 'gauges:get-snapshots',
  /** renderer → main invoke: opens a directory picker and links the account; returns AddAccountResult */
  addAccount: 'gauges:add-account',
  /** renderer → main invoke: removes the account with the given id */
  removeAccount: 'gauges:remove-account',
  /** renderer → main invoke: switches the active account tab */
  setActiveAccount: 'gauges:set-active-account',
  /** renderer → main invoke: forces a usage refresh for the given (or active) account */
  refreshUsage: 'gauges:refresh-usage'
} as const

export type IpcChannelKey = keyof typeof IPC_CHANNELS
export type IpcChannel = (typeof IPC_CHANNELS)[IpcChannelKey]
