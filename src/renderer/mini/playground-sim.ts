/**
 * Pure, DOM-free simulation for the mini-mode pet playground.
 *
 * The pet seeks the nearest folder and eats it on overlap; with no folders it wanders between
 * random points. Folders spawn at random in-bounds positions once per spawn interval, up to
 * {@link MAX_FOLDERS}. All randomness comes from the injected `rng`, so a seeded rng gives a
 * fully deterministic run. `step` and `resize` never mutate their input; they return a new state.
 *
 * Coordinates are in canvas pixels and positions are the **centre** of each entity.
 */

/** Random source returning a number in [0, 1), like `Math.random`. */
export type Rng = () => number

/** Maximum number of uneaten folders on screen at once. */
export const MAX_FOLDERS = 12

/** Default pet footprint (square side) in pixels. */
export const DEFAULT_PET_SIZE = 24

/** Default folder footprint (square side) in pixels. */
export const DEFAULT_FOLDER_SIZE = 16

/** Default pet speed in pixels per second. */
export const DEFAULT_PET_SPEED = 60

/** Distance at which the pet considers a wander point reached. */
const ARRIVAL_EPSILON = 0.5

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Folder extends Point {
  readonly id: number
}

export interface Pet extends Point {
  /** Velocity during the last step, in pixels per second. */
  readonly vx: number
  readonly vy: number
  /** Last horizontal direction travelled (sprites face right; mirror when `'left'`). */
  readonly facing: 'left' | 'right'
  /** Total time spent moving, for choosing walk-animation frames. */
  readonly walkMs: number
}

export interface PlaygroundState {
  readonly width: number
  readonly height: number
  readonly rng: Rng
  readonly petSize: number
  readonly folderSize: number
  readonly petSpeed: number
  readonly pet: Pet
  readonly folders: readonly Folder[]
  /** Folders eaten since the playground was created. */
  readonly eaten: number
  /** Time accumulated toward the next spawn. */
  readonly spawnElapsedMs: number
  readonly nextFolderId: number
  /** Where the pet is heading while there are no folders, or null to pick a new point. */
  readonly wanderTarget: Point | null
}

export interface PlaygroundOptions {
  width: number
  height: number
  rng?: Rng
  petSize?: number
  folderSize?: number
  /** Pixels per second; pass a lower value for reduced motion. */
  petSpeed?: number
}

/** Creates a playground with the pet centred and no folders. */
export function createPlayground(options: PlaygroundOptions): PlaygroundState {
  const width = sanitizeDimension(options.width)
  const height = sanitizeDimension(options.height)
  return {
    width,
    height,
    rng: options.rng ?? Math.random,
    petSize: positiveOr(options.petSize, DEFAULT_PET_SIZE),
    folderSize: positiveOr(options.folderSize, DEFAULT_FOLDER_SIZE),
    petSpeed: nonNegativeOr(options.petSpeed, DEFAULT_PET_SPEED),
    pet: {
      x: width / 2,
      y: height / 2,
      vx: 0,
      vy: 0,
      facing: 'right',
      walkMs: 0
    },
    folders: [],
    eaten: 0,
    spawnElapsedMs: 0,
    nextFolderId: 1,
    wanderTarget: null
  }
}

/**
 * Advances the simulation by `dtMs`. Folders spawn once per `spawnIntervalMs`
 * (none when it is null), then the pet moves toward the nearest folder (or wanders)
 * and eats every folder it overlaps.
 */
export function step(
  state: PlaygroundState,
  dtMs: number,
  spawnIntervalMs: number | null
): PlaygroundState {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0
  if (dt === 0) return state

  const spawned = spawnFolders(state, dt, spawnIntervalMs)
  const moved = movePet(spawned, dt)
  return consumeOverlapping(moved)
}

/** Resizes the playground, scaling every position proportionally and clamping into bounds. */
export function resize(state: PlaygroundState, width: number, height: number): PlaygroundState {
  const newWidth = sanitizeDimension(width)
  const newHeight = sanitizeDimension(height)
  if (newWidth === state.width && newHeight === state.height) return state

  const sx = newWidth / state.width
  const sy = newHeight / state.height
  const next = { ...state, width: newWidth, height: newHeight }
  const scalePoint = (p: Point, size: number): Point =>
    clampPoint({ x: p.x * sx, y: p.y * sy }, size, newWidth, newHeight)

  return {
    ...next,
    pet: { ...state.pet, ...scalePoint(state.pet, state.petSize) },
    folders: state.folders.map((f) => ({
      id: f.id,
      ...scalePoint(f, state.folderSize)
    })),
    wanderTarget: state.wanderTarget && scalePoint(state.wanderTarget, state.petSize)
  }
}

/** The folder closest to `from`, or null when there are none. Ties go to the oldest folder. */
export function nearestFolder(from: Point, folders: readonly Folder[]): Folder | null {
  let best: Folder | null = null
  let bestDistance = Infinity
  for (const folder of folders) {
    const d = distanceSquared(from, folder)
    if (d < bestDistance) {
      best = folder
      bestDistance = d
    }
  }
  return best
}

function spawnFolders(
  state: PlaygroundState,
  dt: number,
  spawnIntervalMs: number | null
): PlaygroundState {
  if (spawnIntervalMs === null || !Number.isFinite(spawnIntervalMs) || spawnIntervalMs <= 0) {
    return state.spawnElapsedMs === 0 ? state : { ...state, spawnElapsedMs: 0 }
  }

  let elapsed = state.spawnElapsedMs + dt
  const due = Math.floor(elapsed / spawnIntervalMs)
  elapsed -= due * spawnIntervalMs
  const room = Math.max(0, MAX_FOLDERS - state.folders.length)
  const count = Math.min(due, room)
  if (count === 0) return { ...state, spawnElapsedMs: elapsed }

  const folders = [...state.folders]
  let nextFolderId = state.nextFolderId
  for (let i = 0; i < count; i++) {
    folders.push({
      id: nextFolderId++,
      ...randomPoint(state, state.folderSize)
    })
  }
  return { ...state, folders, nextFolderId, spawnElapsedMs: elapsed }
}

function movePet(state: PlaygroundState, dt: number): PlaygroundState {
  const folder = nearestFolder(state.pet, state.folders)
  let wanderTarget: Point | null = null
  let target: Point
  if (folder) {
    target = clampPoint(folder, state.petSize, state.width, state.height)
  } else {
    wanderTarget =
      state.wanderTarget && distance(state.pet, state.wanderTarget) > ARRIVAL_EPSILON
        ? state.wanderTarget
        : randomPoint(state, state.petSize)
    target = wanderTarget
  }

  const dx = target.x - state.pet.x
  const dy = target.y - state.pet.y
  const remaining = Math.hypot(dx, dy)
  const travel = Math.min(remaining, (state.petSpeed * dt) / 1000)
  if (travel <= 0) {
    return { ...state, wanderTarget, pet: { ...state.pet, vx: 0, vy: 0 } }
  }

  const ux = dx / remaining
  const uy = dy / remaining
  const position = clampPoint(
    { x: state.pet.x + ux * travel, y: state.pet.y + uy * travel },
    state.petSize,
    state.width,
    state.height
  )
  const vx = (ux * travel * 1000) / dt
  const vy = (uy * travel * 1000) / dt
  const facing = vx < 0 ? 'left' : vx > 0 ? 'right' : state.pet.facing
  return {
    ...state,
    wanderTarget,
    pet: { ...position, vx, vy, facing, walkMs: state.pet.walkMs + dt }
  }
}

function consumeOverlapping(state: PlaygroundState): PlaygroundState {
  const reach = (state.petSize + state.folderSize) / 2
  const remaining = state.folders.filter(
    (f) => Math.abs(f.x - state.pet.x) >= reach || Math.abs(f.y - state.pet.y) >= reach
  )
  const eatenNow = state.folders.length - remaining.length
  if (eatenNow === 0) return state
  return { ...state, folders: remaining, eaten: state.eaten + eatenNow }
}

/** Random centre point that keeps an entity of `size` fully inside the playground. */
function randomPoint(state: PlaygroundState, size: number): Point {
  const [minX, maxX] = axisRange(size, state.width)
  const [minY, maxY] = axisRange(size, state.height)
  return {
    x: minX + unitRandom(state.rng) * (maxX - minX),
    y: minY + unitRandom(state.rng) * (maxY - minY)
  }
}

function clampPoint(p: Point, size: number, width: number, height: number): Point {
  const [minX, maxX] = axisRange(size, width)
  const [minY, maxY] = axisRange(size, height)
  return { x: clamp(p.x, minX, maxX), y: clamp(p.y, minY, maxY) }
}

/** Valid centre range along one axis; collapses to the middle when the entity doesn't fit. */
function axisRange(size: number, extent: number): [number, number] {
  const half = size / 2
  return extent >= size ? [half, extent - half] : [extent / 2, extent / 2]
}

/** Guards against rngs that return values outside [0, 1). */
function unitRandom(rng: Rng): number {
  const value = rng()
  return Number.isFinite(value) ? clamp(value, 0, 1) : 0.5
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function distanceSquared(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

function sanitizeDimension(value: number): number {
  return Number.isFinite(value) && value >= 1 ? value : 1
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback
}
