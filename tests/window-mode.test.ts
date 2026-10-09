import { describe, expect, it } from 'vitest'
import { boundsKeyForMode, windowGeometryForMode } from '../src/main/window-mode'

const maxBounds = { x: 10, y: 20, width: 500, height: 700 }
const miniBounds = { x: 30, y: 40, width: 300, height: 300 }

describe('boundsKeyForMode', () => {
  it('maps each mode to its config key', () => {
    expect(boundsKeyForMode('mini')).toBe('miniWindowBounds')
    expect(boundsKeyForMode('max')).toBe('windowBounds')
  })
})

describe('windowGeometryForMode', () => {
  it('locks mini mode to 1:1 and defaults to 400x400 without saved bounds', () => {
    const geometry = windowGeometryForMode('mini', {
      windowBounds: maxBounds,
      miniWindowBounds: null
    })
    expect(geometry).toEqual({
      aspectRatio: 1,
      minWidth: 260,
      minHeight: 260,
      bounds: null,
      defaultContentSize: { width: 400, height: 400 }
    })
  })

  it('uses saved mini bounds in mini mode', () => {
    const geometry = windowGeometryForMode('mini', {
      windowBounds: maxBounds,
      miniWindowBounds: miniBounds
    })
    expect(geometry.bounds).toEqual(miniBounds)
  })

  it('removes the aspect lock in max mode and restores windowBounds', () => {
    const geometry = windowGeometryForMode('max', {
      windowBounds: maxBounds,
      miniWindowBounds: miniBounds
    })
    expect(geometry.aspectRatio).toBe(0)
    expect(geometry.minWidth).toBe(320)
    expect(geometry.minHeight).toBe(400)
    expect(geometry.bounds).toEqual(maxBounds)
  })

  it('returns null bounds in max mode when none were saved', () => {
    expect(
      windowGeometryForMode('max', { windowBounds: null, miniWindowBounds: miniBounds }).bounds
    ).toBeNull()
  })
})
