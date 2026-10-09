import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  drawPlayground,
  eatenLabel,
  petSpriteFor,
  pixelScaleFor,
  Playground,
  worldSizeFor
} from '../src/renderer/mini/Playground'
import { createPlayground, step } from '../src/renderer/mini/playground-sim'
import { PET_FRAME_A } from '../src/renderer/mini/sprites'

describe('Playground', () => {
  it('renders a canvas and counter via static markup', () => {
    const html = renderToStaticMarkup(
      createElement(Playground, { sessions: [{ status: 'busy', effort: 'high' }] })
    )
    expect(html).toContain('<canvas')
    expect(html).toContain('playground-canvas')
    expect(html).toContain('0 folders eaten')
    expect(html).not.toContain('no busy sessions')
  })

  it('shows an idle hint with no busy sessions', () => {
    const html = renderToStaticMarkup(
      createElement(Playground, { sessions: [{ status: 'idle', effort: 'max' }] })
    )
    expect(html).toContain('no busy sessions')
  })
})

describe('playground helpers', () => {
  it('scales pixels with the shorter side, clamped', () => {
    expect(pixelScaleFor(400, 400)).toBe(4)
    expect(pixelScaleFor(100, 100)).toBe(2)
    expect(pixelScaleFor(4000, 4000)).toBe(8)
    expect(pixelScaleFor(0, 0)).toBe(2)
    expect(worldSizeFor(400, 360)).toEqual({ width: 100, height: 90 })
    expect(worldSizeFor(0, 0)).toEqual({ width: 1, height: 1 })
  })

  it('labels the counter', () => {
    expect(eatenLabel(1)).toBe('1 folder eaten')
    expect(eatenLabel(3)).toBe('3 folders eaten')
  })

  it('uses the standing frame when still and draws folders and pet', () => {
    const state = step(createPlayground({ width: 100, height: 100, rng: () => 0.1 }), 500, 100)
    expect(petSpriteFor(createPlayground({ width: 50, height: 50 }).pet, false)).toBe(PET_FRAME_A)
    let clears = 0
    let fills = 0
    const ctx = {
      fillStyle: '' as unknown,
      imageSmoothingEnabled: false,
      clearRect: () => {
        clears += 1
      },
      fillRect: () => {
        fills += 1
      }
    }
    drawPlayground(ctx, state, false)
    expect(clears).toBe(1)
    expect(fills).toBeGreaterThan(0)
  })
})
