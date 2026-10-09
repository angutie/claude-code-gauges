import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface CssRule {
  selectors: string[]
  declarations: Map<string, string>
  offset: number
}

const css = readFileSync(resolve(__dirname, '../src/renderer/styles.css'), 'utf8')

// Blank out comments with same-length whitespace so offsets still line up with `css`.
const source = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))

// Innermost `selector { declarations }` blocks; good enough for this flat stylesheet.
const rules: CssRule[] = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
  const declarations = new Map<string, string>()
  for (const declaration of match[2].split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    declarations.set(
      declaration.slice(0, colon).trim().toLowerCase(),
      declaration.slice(colon + 1).trim()
    )
  }
  return {
    selectors: match[1]
      .split(',')
      .map((selector) => selector.trim())
      .filter(Boolean),
    declarations,
    offset: match.index ?? 0
  }
})

const miniBannerOffset = css.indexOf('Mini window (1:1)')

const SCROLLERS = ['.app-main', '.app-tabs'] as const

function rulesFor(selectorPattern: RegExp): CssRule[] {
  return rules.filter((rule) => rule.selectors.some((selector) => selectorPattern.test(selector)))
}

function webkitRulesFor(scroller: string, pseudo: string): CssRule[] {
  const escaped = scroller.replace('.', '\\.')
  return rulesFor(new RegExp(`${escaped}(:hover)?::-webkit-${pseudo}$`))
}

function isScopedToMini(selector: string): boolean {
  return /\.mini\b/.test(selector.replace(/:not\(\.mini\)/g, ''))
}

describe('max window scrollbar styles', () => {
  it('locates the mini-mode banner', () => {
    expect(miniBannerOffset).toBeGreaterThan(0)
  })

  for (const scroller of SCROLLERS) {
    describe(scroller, () => {
      it('has a narrow ::-webkit-scrollbar with a transparent background', () => {
        const [bar] = webkitRulesFor(scroller, 'scrollbar')
        expect(bar).toBeDefined()
        expect(bar.declarations.get('background')).toBe('transparent')
        expect(bar.declarations.get('width')).toBe('var(--scrollbar-size)')
        expect(bar.declarations.get('height')).toBe('var(--scrollbar-size)')
      })

      it('has a transparent track and corner', () => {
        for (const pseudo of ['scrollbar-track', 'scrollbar-corner']) {
          const matched = webkitRulesFor(scroller, pseudo)
          expect(matched.length, `${scroller}::-webkit-${pseudo}`).toBeGreaterThan(0)
          for (const rule of matched) {
            expect(rule.declarations.get('background')).toBe('transparent')
          }
        }
      })

      it('hides the thumb unless hovered', () => {
        const thumbs = webkitRulesFor(scroller, 'scrollbar-thumb')
        const resting = thumbs.find((rule) =>
          rule.selectors.some((s) => s.endsWith(`${scroller}::-webkit-scrollbar-thumb`))
        )
        const hovered = thumbs.find((rule) =>
          rule.selectors.some((s) => s.endsWith(`${scroller}:hover::-webkit-scrollbar-thumb`))
        )
        expect(resting?.declarations.get('background')).toBe('transparent')
        expect(hovered?.declarations.get('background')).toBe('var(--scrollbar-thumb)')
      })

      it('keeps every webkit scrollbar rule above the mini banner and out of .mini scope', () => {
        const webkitRules = rulesFor(new RegExp(`${scroller.replace('.', '\\.')}.*::-webkit-`))
        expect(webkitRules.length).toBeGreaterThan(0)
        for (const rule of webkitRules) {
          expect(rule.offset).toBeLessThan(miniBannerOffset)
          for (const selector of rule.selectors) {
            expect(isScopedToMini(selector), selector).toBe(false)
          }
        }
      })

      it('does not set scrollbar-width or scrollbar-color (Chromium would ignore the webkit rules)', () => {
        const pattern = new RegExp(`${scroller.replace('.', '\\.')}(?![\\w-])`)
        for (const rule of rulesFor(pattern)) {
          expect(rule.declarations.has('scrollbar-width'), rule.selectors.join(', ')).toBe(false)
          expect(rule.declarations.has('scrollbar-color'), rule.selectors.join(', ')).toBe(false)
        }
      })
    })
  }

  it('does not inherit scrollbar-color from an ancestor of the max scrollers', () => {
    // scrollbar-color is inherited, so setting it on an ancestor would also disable the webkit rules.
    const ancestorPattern = /^(:root|html|body|#root|\.app|\*)$/
    for (const rule of rulesFor(ancestorPattern)) {
      expect(rule.declarations.has('scrollbar-color'), rule.selectors.join(', ')).toBe(false)
    }
  })

  it('defines the scrollbar tokens in :root', () => {
    const [root] = rulesFor(/^:root$/)
    expect(root?.declarations.get('--scrollbar-size')).toBe('4px')
    expect(root?.declarations.get('--scrollbar-thumb')).toBeTruthy()
  })
})
