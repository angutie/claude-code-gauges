import type { AppConfig, WindowBounds, WindowMode } from '../shared/types'

/** Content size used when the mini window has no saved bounds. */
export const MINI_DEFAULT_SIZE = 400
/** Smallest square the mini window can be resized to. */
export const MINI_MIN_SIZE = 260
export const MAX_DEFAULT_WIDTH = 420
export const MAX_DEFAULT_HEIGHT = 640
export const MAX_MIN_WIDTH = 320
export const MAX_MIN_HEIGHT = 400

/** Config key that stores the persisted bounds for each window mode. */
export type BoundsKey = 'windowBounds' | 'miniWindowBounds'

/** Window sizing rules for one mode; free of Electron types so it can be unit-tested. */
export interface WindowGeometry {
  /** Content aspect ratio to lock (width / height); 0 removes the lock. */
  aspectRatio: number
  minWidth: number
  minHeight: number
  /** Persisted bounds for this mode, or null when none have been saved yet. */
  bounds: WindowBounds | null
  /** Size to use when no bounds are saved (content size in mini mode). */
  defaultContentSize: { width: number; height: number }
}

/** Maps a window mode to the config key holding its saved bounds. */
export function boundsKeyForMode(mode: WindowMode): BoundsKey {
  return mode === 'mini' ? 'miniWindowBounds' : 'windowBounds'
}

/** Returns the aspect lock, minimum size, and saved/default size for a window mode. */
export function windowGeometryForMode(
  mode: WindowMode,
  config: Pick<AppConfig, BoundsKey>
): WindowGeometry {
  if (mode === 'mini') {
    return {
      aspectRatio: 1,
      minWidth: MINI_MIN_SIZE,
      minHeight: MINI_MIN_SIZE,
      bounds: config.miniWindowBounds,
      defaultContentSize: { width: MINI_DEFAULT_SIZE, height: MINI_DEFAULT_SIZE }
    }
  }
  return {
    aspectRatio: 0,
    minWidth: MAX_MIN_WIDTH,
    minHeight: MAX_MIN_HEIGHT,
    bounds: config.windowBounds,
    defaultContentSize: { width: MAX_DEFAULT_WIDTH, height: MAX_DEFAULT_HEIGHT }
  }
}
