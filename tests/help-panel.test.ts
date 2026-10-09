import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { HelpPanel } from '../src/renderer/components/HelpPanel'
import HelpPanelDefault from '../src/renderer/components/HelpPanel'
import { HELP_TOPICS, isHelpCode } from '../src/renderer/help-content'

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
