import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CompactHelpView, HelpPanel } from '../src/renderer/components/HelpPanel'
import HelpPanelDefault from '../src/renderer/components/HelpPanel'
import { HELP_TOPICS, isHelpCode } from '../src/renderer/help-content'
import { HELP_INDEX_STATE, helpCards, openTopic } from '../src/renderer/help-paging'

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')

type AnyProps = { children?: ReactNode; onClick?: () => void; type?: string }

/** Depth-first walk over a hook-free element tree (only host elements are descended into). */
function findElements(
  node: ReactNode,
  match: (el: ReactElement<AnyProps>) => boolean
): ReactElement<AnyProps>[] {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, match))
  if (!isValidElement<AnyProps>(node)) return []
  const self = match(node) ? [node] : []
  return [...self, ...findElements(node.props.children, match)]
}

describe('HelpPanel', () => {
  it('exports the component as default too', () => {
    expect(HelpPanelDefault).toBe(HelpPanel)
  })

  it('renders an accessible help section with every topic title', () => {
    const html = renderToStaticMarkup(createElement(HelpPanel, { onClose: () => undefined }))
    expect(html).toMatch(/<section class="panel help-panel" aria-label="Help">/)
    expect(html).not.toContain('help-panel--compact')
    for (const topic of HELP_TOPICS) {
      expect(html).toContain(escapeHtml(topic.title))
      for (const section of topic.sections) expect(html).toContain(escapeHtml(section.title))
    }
  })

  it('renders entries and inline code segments as <code>', () => {
    const html = renderToStaticMarkup(createElement(HelpPanel, {}))
    const entries = HELP_TOPICS.flatMap((t) => t.sections.flatMap((s) => s.entries ?? []))
    for (const entry of entries) expect(html).toContain(escapeHtml(entry.term))
    expect(html).toContain('<code>CLAUDE_CONFIG_DIR</code>')
    expect(html).toContain('<code>.credentials.json</code>')

    const codeCount = HELP_TOPICS.flatMap((t) =>
      t.sections.flatMap((s) => [...s.paragraphs, ...(s.entries ?? []).flatMap((e) => e.body)])
    )
      .flat()
      .filter(isHelpCode).length
    expect(html.match(/<code>/g)).toHaveLength(codeCount)
  })

  it('adds the compact modifier when compact', () => {
    const html = renderToStaticMarkup(createElement(HelpPanel, { compact: true }))
    expect(html).toContain('class="panel help-panel help-panel--compact"')
  })

  it('shows a Done button only when onClose is given', () => {
    const withClose = renderToStaticMarkup(createElement(HelpPanel, { onClose: () => undefined }))
    expect(withClose).toMatch(/<button type="button" class="button">Done<\/button>/)
    const without = renderToStaticMarkup(createElement(HelpPanel, {}))
    expect(without).not.toContain('<button')
  })

  it('invokes onClose when the Done button is clicked', () => {
    const onClose = vi.fn()
    const tree = HelpPanel({ onClose })
    const buttons = findElements(tree, (el) => el.type === 'button')
    expect(buttons).toHaveLength(1)
    const [done] = buttons
    expect(done?.props.children).toBe('Done')
    done?.props.onClick?.()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('HelpPanel compact', () => {
  type ViewProps = Parameters<typeof CompactHelpView>[0]
  const view = (state: ViewProps['state'], onNavigate: ViewProps['onNavigate'] = () => undefined) =>
    CompactHelpView({ state, topics: HELP_TOPICS, onNavigate })
  const buttons = (node: ReactNode): ReactElement<AnyProps & { disabled?: boolean }>[] =>
    findElements(node, (el) => el.type === 'button') as ReactElement<
      AnyProps & { disabled?: boolean }
    >[]

  it('shows the topic index by default instead of full topics', () => {
    const html = renderToStaticMarkup(createElement(HelpPanel, { compact: true }))
    expect(html).toContain('class="panel help-panel help-panel--compact"')
    expect(html).toContain('<nav class="help-index" aria-label="Help topics">')
    for (const topic of HELP_TOPICS) {
      expect(html).toContain(`>${escapeHtml(topic.title)}</button>`)
    }
    expect(html).not.toContain('help-topic"')
    expect(html).not.toContain('help-card')
  })

  it('keeps the Done button in compact mode when onClose is given', () => {
    const html = renderToStaticMarkup(
      createElement(HelpPanel, { compact: true, onClose: () => undefined })
    )
    expect(html).toContain('>Done</button>')
  })

  it('opens a topic from the index', () => {
    const onNavigate = vi.fn()
    const index = buttons(view(HELP_INDEX_STATE, onNavigate))
    expect(index).toHaveLength(HELP_TOPICS.length)
    index[1]?.props.onClick?.()
    expect(onNavigate).toHaveBeenCalledWith({ topicId: HELP_TOPICS[1]?.id, page: 0 })
  })

  it('renders one card with Back and ‹ / › buttons, clamped at the ends', () => {
    const topic = HELP_TOPICS[0]!
    const cards = helpCards(topic)
    const first = renderToStaticMarkup(view(openTopic(topic.id)))
    expect(first).toContain(`>1 / ${cards.length}<`)
    expect(first).toContain('>Back</button>')
    expect(first).toMatch(/aria-label="Previous card" disabled=""/)
    expect(first).not.toMatch(/aria-label="Next card" disabled=""/)
    expect(first.match(/class="help-card-body"/g)).toHaveLength(1)

    const last = renderToStaticMarkup(view({ topicId: topic.id, page: 999 }))
    expect(last).toContain(`>${cards.length} / ${cards.length}<`)
    expect(last).toMatch(/aria-label="Next card" disabled=""/)
  })

  it('navigates with buttons: next, previous and back to the index', () => {
    const topic = HELP_TOPICS[0]!
    const onNavigate = vi.fn()
    const [back, prev, next] = buttons(view({ topicId: topic.id, page: 1 }, onNavigate))
    next?.props.onClick?.()
    expect(onNavigate).toHaveBeenLastCalledWith({ topicId: topic.id, page: 2 })
    prev?.props.onClick?.()
    expect(onNavigate).toHaveBeenLastCalledWith({ topicId: topic.id, page: 0 })
    back?.props.onClick?.()
    expect(onNavigate).toHaveBeenLastCalledWith(HELP_INDEX_STATE)
  })

  it('adds no keyboard handlers so carousel arrow keys keep working', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/renderer/components/HelpPanel.tsx', import.meta.url)),
      'utf8'
    )
    expect(source).not.toMatch(/onKey(Down|Up|Press)|addEventListener|Arrow(Left|Right)/)
  })
})
