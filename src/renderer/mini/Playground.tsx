import { useEffect, useMemo, useRef, useState } from 'react'
import type { SessionInfo } from '../../shared/types'
import { createPlayground, resize, step, type Pet, type PlaygroundState, type Rng } from './playground-sim'
import { folderSpawnIntervalMs } from './spawn-rate'
import {
  drawSprite,
  FOLDER_SPRITE,
  PET_FRAME_A,
  petWalkFrame,
  type Sprite,
  type SpriteContext
} from './sprites'

/**
 * Mini-only pet playground: a pixelated canvas where the Claude pet eats folders that spawn
 * faster the more (and harder) sessions are busy.
 *
 * The canvas backing store is a low-resolution "world" (CSS size / pixel scale) scaled up with
 * `image-rendering: pixelated`, so sprites are drawn at 1 world pixel per sprite pixel.
 * Written against structural types only (no DOM lib), because the node tsconfig includes it.
 */

/** Pet speed in world pixels per second. */
export const PET_SPEED = 24

/** Pet speed when the user prefers reduced motion. */
export const REDUCED_MOTION_PET_SPEED = 6

/** Milliseconds per walk frame (normal / reduced motion). */
export const WALK_FRAME_MS = 180
export const REDUCED_MOTION_WALK_FRAME_MS = 720

/** Longest simulated step, so a stalled frame can't teleport the pet. */
export const MAX_FRAME_DT_MS = 100

/** Target number of world pixels along the shorter side of the canvas. */
const WORLD_PIXELS_TARGET = 96
const MIN_PIXEL_SCALE = 2
const MAX_PIXEL_SCALE = 8

export interface PlaygroundProps {
  /** Watched sessions; busy ones drive the folder spawn rate. */
  sessions: readonly Pick<SessionInfo, 'status' | 'effort'>[]
  /** Random source for the simulation (tests); defaults to Math.random. */
  rng?: Rng
}

/** CSS pixels per world pixel for a canvas of the given CSS size. */
export function pixelScaleFor(cssWidth: number, cssHeight: number): number {
  const side = Math.min(cssWidth, cssHeight)
  if (!Number.isFinite(side) || side <= 0) return MIN_PIXEL_SCALE
  const scale = Math.round(side / WORLD_PIXELS_TARGET)
  return Math.min(MAX_PIXEL_SCALE, Math.max(MIN_PIXEL_SCALE, scale))
}

/** World (canvas backing-store) size for a CSS size; always at least 1×1. */
export function worldSizeFor(cssWidth: number, cssHeight: number): { width: number; height: number } {
  const scale = pixelScaleFor(cssWidth, cssHeight)
  return {
    width: Math.max(1, Math.floor(cssWidth / scale)),
    height: Math.max(1, Math.floor(cssHeight / scale))
  }
}

/** Sprite to draw for the pet: animated while moving, standing frame when still. */
export function petSpriteFor(pet: Pet, reducedMotion: boolean): Sprite {
  const moving = pet.vx !== 0 || pet.vy !== 0
  if (!moving) return PET_FRAME_A
  return petWalkFrame(pet.walkMs / (reducedMotion ? REDUCED_MOTION_WALK_FRAME_MS : WALK_FRAME_MS))
}

/** Text for the eaten-folder counter. */
export function eatenLabel(eaten: number): string {
  return `${eaten} ${eaten === 1 ? 'folder' : 'folders'} eaten`
}

/** The slice of CanvasRenderingContext2D the playground draws with. */
export interface PlaygroundContext extends SpriteContext {
  imageSmoothingEnabled: boolean
  clearRect(x: number, y: number, width: number, height: number): void
}

/** Draws one frame of the playground: folders first, then the pet on top. */
export function drawPlayground(
  ctx: PlaygroundContext,
  state: PlaygroundState,
  reducedMotion: boolean
): void {
  ctx.clearRect(0, 0, state.width, state.height)
  for (const folder of state.folders) {
    drawCentred(ctx, FOLDER_SPRITE, folder.x, folder.y, false)
  }
  const pet = petSpriteFor(state.pet, reducedMotion)
  drawCentred(ctx, pet, state.pet.x, state.pet.y, state.pet.facing === 'left')
}

function drawCentred(
  ctx: SpriteContext,
  sprite: Sprite,
  cx: number,
  cy: number,
  flip: boolean
): void {
  drawSprite(
    ctx,
    sprite,
    Math.round(cx - sprite.width / 2),
    Math.round(cy - sprite.height / 2),
    1,
    flip
  )
}

interface CanvasLike {
  width: number
  height: number
  getContext(type: '2d'): PlaygroundContext | null
}

interface SizedElement {
  clientWidth: number
  clientHeight: number
}

interface Listenable {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

interface MediaQueryLike extends Partial<Listenable> {
  matches: boolean
}

interface ObserverLike {
  observe(target: unknown): void
  disconnect(): void
}

/** Browser globals the animation loop needs, looked up structurally on globalThis. */
interface BrowserEnv {
  requestAnimationFrame(callback: (timeMs: number) => void): number
  cancelAnimationFrame(handle: number): void
  ResizeObserver?: new (callback: () => void) => ObserverLike
  document?: Listenable & { visibilityState?: string }
  matchMedia?: (query: string) => MediaQueryLike
}

function browserEnv(): BrowserEnv | null {
  const env = globalThis as unknown as Partial<BrowserEnv>
  if (typeof env.requestAnimationFrame !== 'function') return null
  if (typeof env.cancelAnimationFrame !== 'function') return null
  return env as BrowserEnv
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Pixel-art pet playground filling its container; animates only while mounted and visible. */
export function Playground({ sessions, rng }: PlaygroundProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [eaten, setEaten] = useState(0)

  const spawnIntervalMs = useMemo(() => folderSpawnIntervalMs(sessions), [sessions])
  // The loop reads the latest interval without restarting when sessions change.
  const spawnIntervalRef = useRef(spawnIntervalMs)
  spawnIntervalRef.current = spawnIntervalMs
  const rngRef = useRef(rng)
  rngRef.current = rng

  useEffect(() => {
    const env = browserEnv()
    const canvas = canvasRef.current as unknown as CanvasLike | null
    const container = containerRef.current as unknown as SizedElement | null
    if (!env || !canvas || !container) return undefined
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined

    let sim: PlaygroundState | null = null
    let frame: number | null = null
    let lastTime: number | null = null
    let shownEaten = 0
    const motionQuery = env.matchMedia?.(REDUCED_MOTION_QUERY) ?? null
    let reducedMotion = motionQuery?.matches ?? false
    const petSpeed = (): number => (reducedMotion ? REDUCED_MOTION_PET_SPEED : PET_SPEED)

    const draw = (): void => {
      if (sim) drawPlayground(ctx, sim, reducedMotion)
    }

    const isHidden = (): boolean => env.document?.visibilityState === 'hidden'

    const tick = (timeMs: number): void => {
      frame = null
      const dt = lastTime === null ? 0 : Math.min(MAX_FRAME_DT_MS, Math.max(0, timeMs - lastTime))
      lastTime = timeMs
      if (sim) {
        sim = step(sim, dt, spawnIntervalRef.current)
        draw()
        if (sim.eaten !== shownEaten) {
          shownEaten = sim.eaten
          setEaten(shownEaten)
        }
      }
      frame = env.requestAnimationFrame(tick)
    }

    const start = (): void => {
      if (frame !== null || isHidden()) return
      lastTime = null
      frame = env.requestAnimationFrame(tick)
    }

    const stop = (): void => {
      if (frame !== null) env.cancelAnimationFrame(frame)
      frame = null
    }

    const fit = (): void => {
      const { width, height } = worldSizeFor(container.clientWidth, container.clientHeight)
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
      // Resizing the backing store resets context state, so re-disable smoothing every time.
      ctx.imageSmoothingEnabled = false
      sim = sim
        ? resize(sim, width, height)
        : createPlayground({ width, height, rng: rngRef.current, petSpeed: petSpeed() })
      draw()
    }

    const onVisibilityChange = (): void => {
      if (isHidden()) stop()
      else start()
    }

    const onMotionChange = (): void => {
      reducedMotion = motionQuery?.matches ?? false
      if (sim) sim = { ...sim, petSpeed: petSpeed() }
    }

    fit()
    const observer = env.ResizeObserver ? new env.ResizeObserver(fit) : null
    observer?.observe(container)
    env.document?.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery?.addEventListener?.('change', onMotionChange)
    start()

    return () => {
      stop()
      observer?.disconnect()
      env.document?.removeEventListener('visibilitychange', onVisibilityChange)
      motionQuery?.removeEventListener?.('change', onMotionChange)
    }
  }, [])

  return (
    <div ref={containerRef} className="playground">
      <canvas
        ref={canvasRef}
        className="playground-canvas"
        role="img"
        aria-label="Pixel Claude pet eating folders"
      />
      <div className="playground-hud">
        <span className="playground-counter" aria-live="polite">
          {eatenLabel(eaten)}
        </span>
        {spawnIntervalMs === null && (
          <span className="playground-idle">no busy sessions</span>
        )}
      </div>
    </div>
  )
}

export default Playground
