/**
 * Inline pixel-art sprites for the mini-mode pet playground, plus a tiny renderer.
 * Deliberately free of DOM types so it compiles under the node tsconfig and is unit-testable;
 * `drawSprite` accepts any object shaped like the parts of CanvasRenderingContext2D it uses.
 */

/** Character marking a transparent pixel in a sprite grid. */
export const TRANSPARENT = '.'

/** The app's Claude-orange accent (matches `--color-accent` in styles.css). */
export const CLAUDE_ORANGE = '#d97757'

/** A rectangular pixel grid: one string per row, one character per pixel, mapped through `palette`. */
export interface Sprite {
  readonly width: number
  readonly height: number
  readonly rows: readonly string[]
  readonly palette: Readonly<Record<string, string>>
}

/** The minimal structural slice of a 2D canvas context that `drawSprite` needs. */
export interface SpriteContext {
  fillStyle: unknown
  fillRect(x: number, y: number, width: number, height: number): void
}

/**
 * Builds a sprite from rows of palette characters, throwing if the grid is not rectangular
 * or uses a character missing from the palette (catches typos in the inline art).
 */
export function defineSprite(rows: readonly string[], palette: Record<string, string>): Sprite {
  const width = rows[0]?.length ?? 0
  if (rows.length === 0 || width === 0) throw new Error('Sprite must have at least one pixel')
  rows.forEach((row, index) => {
    if (row.length !== width) {
      throw new Error(`Sprite row ${index} has width ${row.length}, expected ${width}`)
    }
    for (const char of row) {
      if (char !== TRANSPARENT && palette[char] === undefined) {
        throw new Error(`Sprite row ${index} uses unknown palette key "${char}"`)
      }
    }
  })
  return { width, height: rows.length, rows: [...rows], palette: { ...palette } }
}

const PET_PALETTE = {
  o: CLAUDE_ORANGE,
  d: '#a8553a',
  k: '#1a1d24'
}

const PET_BODY = [
  '..oooooooo..',
  '..oooooooo..',
  '..oookooko..',
  '..oookooko..',
  'oooooooooooo',
  'oooooooooooo',
  '..oooooooo..',
  '..dddddddd..'
]

/** Pet walk frame A (legs together). The pet faces right; flip to face left. */
export const PET_FRAME_A = defineSprite(
  [...PET_BODY, '..o.o..o.o..', '..o.o..o.o..'],
  PET_PALETTE
)

/** Pet walk frame B (legs apart). The pet faces right; flip to face left. */
export const PET_FRAME_B = defineSprite(
  [...PET_BODY, '.o.o....o.o.', '.o.o....o.o.'],
  PET_PALETTE
)

/** Walk cycle frames, in order. */
export const PET_WALK_FRAMES: readonly Sprite[] = [PET_FRAME_A, PET_FRAME_B]

/** Returns the walk frame for an ever-increasing frame counter. */
export function petWalkFrame(frameIndex: number): Sprite {
  const count = PET_WALK_FRAMES.length
  const index = ((Math.floor(frameIndex) % count) + count) % count
  return PET_WALK_FRAMES[index] as Sprite
}

/** Pet sprites face right, so they are mirrored whenever the pet moves left. */
export function petFlipForVelocity(vx: number): boolean {
  return vx < 0
}

/** Folder icon eaten by the pet. */
export const FOLDER_SPRITE = defineSprite(
  [
    'eeee......',
    'efffeeeeee',
    'eFFFFFFFFe',
    'eFFFFFFFFe',
    'eFFFFFFFFe',
    'eFFFFFFFFe',
    'eeeeeeeeee'
  ],
  { e: '#b5832e', f: '#e8b04a', F: '#f2c46d' }
)

/**
 * Draws `sprite` with its top-left corner at (x, y), each pixel as a `scale`×`scale` square.
 * Issues exactly one fillRect per opaque pixel; when `flip` is true the sprite is mirrored
 * horizontally within the same bounding box.
 */
export function drawSprite(
  ctx: SpriteContext,
  sprite: Sprite,
  x: number,
  y: number,
  scale: number,
  flip = false
): void {
  sprite.rows.forEach((row, rowIndex) => {
    for (let col = 0; col < sprite.width; col += 1) {
      const char = row[col] as string
      if (char === TRANSPARENT) continue
      const color = sprite.palette[char]
      if (color === undefined) continue
      const drawCol = flip ? sprite.width - 1 - col : col
      ctx.fillStyle = color
      ctx.fillRect(x + drawCol * scale, y + rowIndex * scale, scale, scale)
    }
  })
}
