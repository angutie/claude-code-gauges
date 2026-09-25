import { contextBridge } from 'electron'

const api = {
  platform: process.platform
}

export type GaugesApi = typeof api

contextBridge.exposeInMainWorld('gauges', api)
