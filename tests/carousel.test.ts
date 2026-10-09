import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  Carousel,
  carouselSlots,
  keyToStep,
  type CarouselScreen
} from '../src/renderer/mini/Carousel'

function makeScreens(count: number, renders: string[] = []): CarouselScreen[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    label: `Screen ${i}`,
    render: () => {
      renders.push(`s${i}`)
      return createElement('p', null, `content-${i}`)
    }
  }))
}

describe('carouselSlots', () => {
  it('returns current, next and prev with wrap-around', () => {
    const slots = carouselSlots(0, makeScreens(4))
    expect(slots.map((s) => [s.role, s.index])).toEqual([
      ['current', 0],
      ['next', 1],
      ['prev', 3]
    ])
    expect(carouselSlots(3, makeScreens(4)).map((s) => s.index)).toEqual([3, 0, 2])
  })

  it('never renders a screen twice with fewer than three screens', () => {
    expect(carouselSlots(0, makeScreens(2)).map((s) => s.index)).toEqual([0, 1])
    expect(carouselSlots(0, makeScreens(1)).map((s) => s.role)).toEqual(['current'])
    expect(carouselSlots(0, [])).toEqual([])
  })

  it('wraps out-of-range indices', () => {
    expect(carouselSlots(-1, makeScreens(4))[0].index).toBe(3)
    expect(carouselSlots(5, makeScreens(4))[0].index).toBe(1)
  })
})

describe('keyToStep', () => {
  it('maps arrow keys to steps', () => {
    expect(keyToStep('ArrowLeft')).toBe(-1)
    expect(keyToStep('ArrowRight')).toBe(1)
    expect(keyToStep('ArrowUp')).toBe(0)
    expect(keyToStep('Enter')).toBe(0)
  })
})

describe('Carousel', () => {
  it('renders carousel and slide ARIA attributes', () => {
    const html = renderToStaticMarkup(
      createElement(Carousel, { screens: makeScreens(4), label: 'Mini screens' })
    )
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-roledescription="carousel"')
    expect(html).toContain('aria-label="Mini screens"')
    expect(html).toContain('aria-roledescription="slide"')
    expect(html).toContain('aria-label="Screen 0 (1 of 4)"')
    expect(html).toContain('tabindex="0"')
  })

  it('mounts only the current screen', () => {
    const renders: string[] = []
    const html = renderToStaticMarkup(
      createElement(Carousel, { screens: makeScreens(4, renders), initialIndex: 2 })
    )
    expect(renders).toEqual(['s2'])
    expect(html).toContain('content-2')
    expect(html).not.toContain('content-1')
    expect(html).not.toContain('content-3')
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(1)
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2)
    expect(html).toContain('carousel-slide--prev')
    expect(html).toContain('carousel-slide--next')
  })

  it('renders one pager dot per screen with the current one marked', () => {
    const html = renderToStaticMarkup(
      createElement(Carousel, { screens: makeScreens(4), initialIndex: 1 })
    )
    expect(html.match(/class="carousel-dot/g)).toHaveLength(4)
    expect(html).toContain('aria-label="Show Screen 3"')
    expect(html.match(/aria-current="true"/g)).toHaveLength(1)
    expect(html).toMatch(/carousel-dot--active"[^>]*aria-label="Show Screen 1"/)
  })

  it('omits the pager for a single screen and handles no screens', () => {
    expect(renderToStaticMarkup(createElement(Carousel, { screens: makeScreens(1) }))).not.toContain(
      'carousel-dot'
    )
    const empty = renderToStaticMarkup(createElement(Carousel, { screens: [] }))
    expect(empty).toContain('aria-roledescription="carousel"')
  })
})
