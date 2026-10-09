import { describe, expect, it } from 'vitest'
import {
  CLAUDE_ORANGE,
  FOLDER_SPRITE,
  PET_FRAME_A,
  PET_FRAME_B,
  PET_WALK_FRAMES,
  TRANSPARENT,
  defineSprite,
  drawSprite,
  petFlipForVelocity,
  petWalkFrame,
  type Sprite,
  type SpriteContext
} from '../src/renderer/mini/sprites'

interface FillCall {
  color: unknown
  x: number
  y: number
  w: number
  h: number
}

function createFakeContext(): SpriteContext & { calls: FillCall[] } {
  const calls: FillCall[] = []
  return {
    calls,
    fillStyle: '',
    fillRect(x, y, w, h) {
      calls.push({ color: this.fillStyle, x, y, w, h })
    }
  }
}

function opaqueCount(sprite: Sprite): number {
  return sprite.rows.join('').split('').filter((char) => char !== TRANSPARENT).length
}

const ALL_SPRITES: Array<[string, Sprite]> = [
  ['pet frame A', PET_FRAME_A],
  ['pet frame B', PET_FRAME_B],
  ['folder', FOLDER_SPRITE]
]

describe('sprite data', () => {
  it.each(ALL_SPRITES)('%s is a rectangular grid fully covered by its palette', (_, sprite) => {
    expect(sprite.rows).toHaveLength(sprite.height)
    for (const row of sprite.rows) {
      expect(row).toHaveLength(sprite.width)
      for (const char of row) {
        if (char !== TRANSPARENT) expect(sprite.palette[char]).toBeDefined()
      }
    }
  })

  it('pet uses the Claude-orange accent', () => {
    for (const frame of PET_WALK_FRAMES) {
      expect(Object.values(frame.palette)).toContain(CLAUDE_ORANGE)
    }
    expect(CLAUDE_ORANGE).toBe('#d97757')
  })

  it('walk frames share dimensions but differ', () => {
    expect(PET_WALK_FRAMES).toHaveLength(2)
    expect(PET_FRAME_B.width).toBe(PET_FRAME_A.width)
    expect(PET_FRAME_B.height).toBe(PET_FRAME_A.height)
    expect(PET_FRAME_B.rows).not.toEqual(PET_FRAME_A.rows)
  })

  it('petWalkFrame cycles through frames', () => {
    expect(petWalkFrame(0)).toBe(PET_FRAME_A)
    expect(petWalkFrame(1)).toBe(PET_FRAME_B)
    expect(petWalkFrame(2)).toBe(PET_FRAME_A)
    expect(petWalkFrame(-1)).toBe(PET_FRAME_B)
  })

  it('petFlipForVelocity mirrors only when moving left', () => {
    expect(petFlipForVelocity(-1)).toBe(true)
    expect(petFlipForVelocity(0)).toBe(false)
    expect(petFlipForVelocity(2)).toBe(false)
  })
})

describe('defineSprite', () => {
  it('rejects ragged rows', () => {
    expect(() => defineSprite(['aa', 'a'], { a: '#000' })).toThrow(/width/)
  })

  it('rejects unknown palette keys', () => {
    expect(() => defineSprite(['ab'], { a: '#000' })).toThrow(/palette/)
  })

  it('rejects empty sprites', () => {
    expect(() => defineSprite([], {})).toThrow()
  })
})

describe('drawSprite', () => {
  const tiny = defineSprite(['a.', '.b'], { a: '#111', b: '#222' })

  it('issues one fillRect per opaque pixel at the given scale', () => {
    const ctx = createFakeContext()
    drawSprite(ctx, tiny, 10, 20, 3)
    expect(ctx.calls).toEqual([
      { color: '#111', x: 10, y: 20, w: 3, h: 3 },
      { color: '#222', x: 13, y: 23, w: 3, h: 3 }
    ])
  })

  it('mirrors horizontally when flipped', () => {
    const ctx = createFakeContext()
    drawSprite(ctx, tiny, 10, 20, 3, true)
    expect(ctx.calls).toEqual([
      { color: '#111', x: 13, y: 20, w: 3, h: 3 },
      { color: '#222', x: 10, y: 23, w: 3, h: 3 }
    ])
  })

  it.each(ALL_SPRITES)('%s draws every opaque pixel exactly once', (_, sprite) => {
    const ctx = createFakeContext()
    drawSprite(ctx, sprite, 0, 0, 2)
    expect(ctx.calls).toHaveLength(opaqueCount(sprite))

    const flipped = createFakeContext()
    drawSprite(flipped, sprite, 0, 0, 2, true)
    expect(flipped.calls).toHaveLength(opaqueCount(sprite))
    const maxX = (sprite.width - 1) * 2
    const mirrored = flipped.calls.map((call) => ({ ...call, x: maxX - call.x }))
    expect(new Set(mirrored.map((c) => `${c.x},${c.y},${String(c.color)}`))).toEqual(
      new Set(ctx.calls.map((c) => `${c.x},${c.y},${String(c.color)}`))
    )
  })
})
