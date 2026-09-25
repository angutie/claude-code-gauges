import type { GaugesApi } from '../renderer/api'

declare global {
  interface Window {
    /** Typed bridge exposed by src/preload/index.ts via contextBridge. */
    gauges: GaugesApi
  }
}

export {}
