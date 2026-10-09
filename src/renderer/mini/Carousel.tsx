import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import {
  createWheelState,
  DEFAULT_WHEEL_OPTIONS,
  horizontalDelta,
  nextIndex,
  reduceWheel,
  visibleSlots,
  type CarouselStep,
  type WheelOptions
} from './carousel-logic'

/**
 * Infinite horizontal carousel for the mini window.
 * Written against React types only (no DOM lib types) so it also compiles under the node tsconfig,
 * which pulls it in through tests.
 */

/** One carousel screen. `render` is only called for the current screen. */
export interface CarouselScreen {
  id: string
  label: string
  render: () => ReactNode
}

export interface CarouselProps {
  screens: readonly CarouselScreen[]
  /** Accessible name of the carousel region. */
  label?: string
  /** Screen shown on first render (wrapped into range). */
  initialIndex?: number
  onIndexChange?: (index: number) => void
  wheelOptions?: WheelOptions
}

/** Position of a rendered slot relative to the viewport. */
export type SlotRole = 'prev' | 'current' | 'next'

export interface CarouselSlot {
  role: SlotRole
  index: number
  screen: CarouselScreen
}

/**
 * The slots to render for `index`: prev / current / next, deduplicated so a screen is never
 * rendered twice when there are fewer than three screens.
 */
export function carouselSlots(index: number, screens: readonly CarouselScreen[]): CarouselSlot[] {
  if (screens.length === 0) return []
  const slots = visibleSlots(index, screens.length)
  const order: Array<[SlotRole, number]> = [
    ['current', slots.current],
    ['next', slots.next],
    ['prev', slots.prev]
  ]
  const seen = new Set<number>()
  const result: CarouselSlot[] = []
  for (const [role, i] of order) {
    if (seen.has(i)) continue
    seen.add(i)
    result.push({ role, index: i, screen: screens[i] })
  }
  return result
}

/** Maps a keyboard key to a carousel step (ArrowLeft = previous, ArrowRight = next). */
export function keyToStep(key: string): CarouselStep {
  if (key === 'ArrowLeft') return -1
  if (key === 'ArrowRight') return 1
  return 0
}

/** True when keyboard arrows should stay with the focused control (text fields, sliders, selects). */
function isTextEntryTarget(target: unknown): boolean {
  if (typeof target !== 'object' || target === null) return false
  const tagName = (target as { tagName?: unknown }).tagName
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

/** Minimal structural view of a DOM wheel event, so no DOM lib types are needed. */
interface WheelEventLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  shiftKey: boolean
  timeStamp: number
  preventDefault(): void
}

interface WheelTarget {
  addEventListener(
    type: 'wheel',
    listener: (event: WheelEventLike) => void,
    options: { passive: boolean }
  ): void
  removeEventListener(type: 'wheel', listener: (event: WheelEventLike) => void): void
}

function isWheelTarget(value: unknown): value is WheelTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { addEventListener?: unknown }).addEventListener === 'function'
  )
}

/** Horizontally scrolling, infinitely wrapping carousel rendering only prev/current/next slots. */
export function Carousel({
  screens,
  label = 'Screens',
  initialIndex = 0,
  onIndexChange,
  wheelOptions = DEFAULT_WHEEL_OPTIONS
}: CarouselProps): React.JSX.Element {
  const count = screens.length
  const [position, setPosition] = useState<{ index: number; previous: number | null }>(() => ({
    index: nextIndex(initialIndex, 0, count),
    previous: null
  }))
  const regionRef = useRef<HTMLDivElement>(null)
  const wheelState = useRef(createWheelState())
  const current = nextIndex(position.index, 0, count)
  const previousIndex = position.previous
  // Mirrors the current index so callbacks stay stable and side effects stay out of state updaters.
  const currentRef = useRef(current)
  currentRef.current = current

  const goTo = useCallback(
    (target: number) => {
      const from = currentRef.current
      const to = nextIndex(target, 0, count)
      if (to === from) return
      currentRef.current = to
      setPosition({ index: to, previous: from })
      onIndexChange?.(to)
    },
    [count, onIndexChange]
  )

  const step = useCallback(
    (dir: CarouselStep) => {
      if (dir !== 0) goTo(currentRef.current + dir)
    },
    [goTo]
  )

  // React's onWheel is passive, so preventDefault needs a native, non-passive listener.
  useEffect(() => {
    const element: unknown = regionRef.current
    if (!isWheelTarget(element)) return undefined
    const onWheel = (event: WheelEventLike): void => {
      const input = {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        shiftKey: event.shiftKey,
        deltaMode: event.deltaMode
      }
      if (horizontalDelta(input) === 0) return
      event.preventDefault()
      const result = reduceWheel(
        wheelState.current,
        { ...input, timeMs: event.timeStamp },
        wheelOptions
      )
      wheelState.current = result.state
      step(result.step)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [step, wheelOptions])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (isTextEntryTarget(event.target)) return
    const dir = keyToStep(event.key)
    if (dir === 0) return
    event.preventDefault()
    step(dir)
  }

  if (count === 0) {
    return <div className="carousel" role="region" aria-roledescription="carousel" aria-label={label} />
  }

  return (
    <div
      ref={regionRef}
      className="carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="carousel-viewport" aria-live="polite">
        {carouselSlots(current, screens).map(({ role, index: i, screen }) => {
          // Only the screen sliding in or out animates; others reposition off-screen instantly.
          const animated = role === 'current' || i === previousIndex
          const className = `carousel-slide carousel-slide--${role}${animated ? '' : ' carousel-slide--instant'}`
          if (role !== 'current') {
            return <div key={screen.id} className={className} aria-hidden="true" />
          }
          return (
            <div
              key={screen.id}
              className={className}
              role="group"
              aria-roledescription="slide"
              aria-label={`${screen.label} (${i + 1} of ${count})`}
            >
              {screen.render()}
            </div>
          )
        })}
      </div>
      {count > 1 && (
        <div className="carousel-pager" role="group" aria-label="Choose screen">
          {screens.map((screen, i) => (
            <button
              key={screen.id}
              type="button"
              className={`carousel-dot${i === current ? ' carousel-dot--active' : ''}`}
              aria-label={`Show ${screen.label}`}
              aria-current={i === current ? 'true' : undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default Carousel
