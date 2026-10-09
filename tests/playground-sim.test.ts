import { describe, expect, it } from 'vitest'
import {
  MAX_FOLDERS,
  createPlayground,
  nearestFolder,
  resize,
  step,
  type PlaygroundState,
  type Rng
} from '../src/renderer/mini/playground-sim'

/** Small deterministic LCG so runs are reproducible. */
function seededRng(seed: number): Rng {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function constantRng(value: number): Rng {
  return () => value
}

function withFolders(state: PlaygroundState, points: Array<[number, number]>): PlaygroundState {
  return {
    ...state,
    folders: points.map(([x, y], i) => ({ id: i + 1, x, y })),
    nextFolderId: points.length + 1
  }
}

function run(state: PlaygroundState, steps: number, dtMs: number, interval: number | null) {
  let current = state
  for (let i = 0; i < steps; i++) current = step(current, dtMs, interval)
  return current
}

function expectPetInBounds(state: PlaygroundState): void {
  const half = state.petSize / 2
  expect(state.pet.x).toBeGreaterThanOrEqual(half)
  expect(state.pet.x).toBeLessThanOrEqual(state.width - half)
  expect(state.pet.y).toBeGreaterThanOrEqual(half)
  expect(state.pet.y).toBeLessThanOrEqual(state.height - half)
}

describe('createPlayground', () => {
  it('centres the pet with no folders and nothing eaten', () => {
    const state = createPlayground({
      width: 400,
      height: 300,
      rng: constantRng(0.5)
    })
    expect(state.pet.x).toBe(200)
    expect(state.pet.y).toBe(150)
    expect(state.folders).toEqual([])
    expect(state.eaten).toBe(0)
  })
})

describe('step', () => {
  it('is deterministic for the same seeded rng', () => {
    const a = run(createPlayground({ width: 300, height: 300, rng: seededRng(42) }), 500, 16, 400)
    const b = run(createPlayground({ width: 300, height: 300, rng: seededRng(42) }), 500, 16, 400)
    expect(a.pet).toEqual(b.pet)
    expect(a.folders).toEqual(b.folders)
    expect(a.eaten).toBe(b.eaten)
  })

  it('does not mutate the input state', () => {
    const state = createPlayground({
      width: 200,
      height: 200,
      rng: seededRng(1)
    })
    const snapshot = structuredClone({
      pet: state.pet,
      folders: state.folders
    })
    step(state, 1000, 100)
    expect({ pet: state.pet, folders: state.folders }).toEqual(snapshot)
  })

  it('keeps the pet within bounds over a long run', () => {
    let state = createPlayground({
      width: 260,
      height: 260,
      rng: seededRng(7),
      petSpeed: 500
    })
    for (let i = 0; i < 2000; i++) {
      state = step(state, 33, i % 3 === 0 ? 150 : null)
      expectPetInBounds(state)
    }
  })

  it('spawns one folder per elapsed interval, inside bounds', () => {
    const start = createPlayground({
      width: 400,
      height: 400,
      rng: seededRng(3),
      petSpeed: 0
    })
    const once = step(start, 999, 1000)
    expect(once.folders).toHaveLength(0)
    const twice = step(once, 1, 1000)
    expect(twice.folders).toHaveLength(1)
    const later = step(twice, 3000, 1000)
    expect(later.folders).toHaveLength(4)
    for (const f of later.folders) {
      expect(f.x).toBeGreaterThanOrEqual(start.folderSize / 2)
      expect(f.x).toBeLessThanOrEqual(400 - start.folderSize / 2)
      expect(f.y).toBeGreaterThanOrEqual(start.folderSize / 2)
      expect(f.y).toBeLessThanOrEqual(400 - start.folderSize / 2)
    }
    expect(new Set(later.folders.map((f) => f.id)).size).toBe(4)
  })

  it('never exceeds the folder cap', () => {
    let state = createPlayground({
      width: 400,
      height: 400,
      rng: seededRng(9),
      petSpeed: 0
    })
    state = step(state, 60_000, 100)
    expect(state.folders).toHaveLength(MAX_FOLDERS)
    state = run(state, 50, 500, 100)
    expect(state.folders.length).toBeLessThanOrEqual(MAX_FOLDERS)
  })

  it('spawns nothing when the interval is null and resets the spawn timer', () => {
    let state = createPlayground({
      width: 400,
      height: 400,
      rng: seededRng(5)
    })
    state = step(state, 900, 1000)
    state = run(state, 100, 1000, null)
    expect(state.folders).toHaveLength(0)
    expect(state.spawnElapsedMs).toBe(0)
    expect(step(state, 500, 1000).folders).toHaveLength(0)
  })

  it('moves toward the nearest folder', () => {
    const base = createPlayground({
      width: 400,
      height: 400,
      rng: constantRng(0.5)
    })
    const state = withFolders(base, [
      [380, 200],
      [150, 200]
    ])
    expect(nearestFolder(state.pet, state.folders)?.id).toBe(2)
    const next = step(state, 100, null)
    expect(next.pet.x).toBeLessThan(200)
    expect(next.pet.y).toBeCloseTo(200)
    expect(next.pet.facing).toBe('left')
    expect(next.pet.vx).toBeLessThan(0)
  })

  it('consumes a folder on overlap and increments the eaten count', () => {
    const base = createPlayground({
      width: 400,
      height: 400,
      rng: constantRng(0.5)
    })
    let state = withFolders(base, [
      [260, 200],
      [20, 20]
    ])
    state = run(state, 30, 50, null)
    expect(state.eaten).toBe(1)
    expect(state.folders.map((f) => f.id)).toEqual([2])
    state = run(state, 200, 50, null)
    expect(state.eaten).toBe(2)
    expect(state.folders).toHaveLength(0)
  })

  it('wanders when there are no folders', () => {
    const state = createPlayground({
      width: 400,
      height: 400,
      rng: seededRng(11)
    })
    const next = run(state, 20, 50, null)
    expect(next.pet.x !== state.pet.x || next.pet.y !== state.pet.y).toBe(true)
    expect(next.wanderTarget).not.toBeNull()
  })

  it('ignores zero, negative and non-finite dt', () => {
    const state = createPlayground({
      width: 200,
      height: 200,
      rng: seededRng(2)
    })
    expect(step(state, 0, 10)).toBe(state)
    expect(step(state, -50, 10)).toBe(state)
    expect(step(state, Number.NaN, 10)).toBe(state)
  })
})

describe('resize', () => {
  it('rescales pet and folder positions proportionally', () => {
    const base = createPlayground({
      width: 400,
      height: 400,
      rng: constantRng(0.5)
    })
    const state = withFolders({ ...base, pet: { ...base.pet, x: 100, y: 300 } }, [[200, 100]])
    const resized = resize(state, 200, 800)
    expect(resized.width).toBe(200)
    expect(resized.height).toBe(800)
    expect(resized.pet.x).toBe(50)
    expect(resized.pet.y).toBe(600)
    expect(resized.folders[0]).toEqual({ id: 1, x: 100, y: 200 })
  })

  it('clamps scaled positions back into bounds', () => {
    const base = createPlayground({
      width: 400,
      height: 400,
      rng: constantRng(0.5)
    })
    const state = {
      ...base,
      pet: { ...base.pet, x: base.petSize / 2, y: 388 }
    }
    const resized = resize(state, 100, 100)
    expectPetInBounds(resized)
  })

  it('returns the same state when the size is unchanged', () => {
    const state = createPlayground({
      width: 300,
      height: 300,
      rng: constantRng(0.5)
    })
    expect(resize(state, 300, 300)).toBe(state)
  })
})
