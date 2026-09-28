import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Account, AccountSnapshot } from '../src/shared/types'
import { AccountTabs } from '../src/renderer/components/AccountTabs'

const accounts: Account[] = [
  { id: 'a', label: '', configDir: 'C:\Users\me\.claude' },
  { id: 'b', label: 'Work', configDir: 'C:\Users\me\.claude-work' }
]

function render(activeId: string | null, snapshots: Record<string, AccountSnapshot> = {}): string {
  return renderToStaticMarkup(
    createElement(AccountTabs, {
      accounts,
      activeId,
      snapshots,
      onSelect: () => undefined,
      onAdd: async () => ({ ok: false as const, error: 'nope' }),
      onRemove: async () => undefined
    })
  )
}

describe('AccountTabs', () => {
  it('renders one tab per account plus an add button', () => {
    const html = render('b')
    expect(html.match(/role="tab"/g)).toHaveLength(2)
    expect(html).toContain('Work')
    expect(html).toContain('C:\Users\me\.claude')
    expect(html).toContain('Add account')
    expect(html).toContain('aria-label="Remove account Work"')
  })

  it('marks only the active account as selected', () => {
    const html = render('b')
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-selected="true"[^>]*>Work</)
  })

  it('prefers the email from the snapshot when no custom label is set', () => {
    const snapshot = { accountId: 'a', identity: { email: 'me@example.com' } } as unknown as AccountSnapshot
    expect(render('a', { a: snapshot })).toContain('me@example.com')
  })

  it('still offers the add button when no accounts are linked', () => {
    const html = renderToStaticMarkup(
      createElement(AccountTabs, {
        accounts: [],
        activeId: null,
        snapshots: {},
        onSelect: () => undefined,
        onAdd: async () => ({ ok: false as const, cancelled: true, error: '' }),
        onRemove: async () => undefined
      })
    )
    expect(html).toContain('Add account')
    expect(html).not.toContain('role="tab"')
  })
})
