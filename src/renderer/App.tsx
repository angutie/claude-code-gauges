import { useEffect } from 'react'
import type { Account, AccountSnapshot } from '../shared/types'
import {
  accountLabel,
  getGaugesStore,
  selectActiveAccount,
  selectActiveSnapshot,
  useGauges,
  type GaugesStore
} from './store'
import './styles.css'

interface AppProps {
  store?: GaugesStore
}

function StateMessage({
  children,
  variant
}: {
  children: React.ReactNode
  variant?: 'error'
}): React.JSX.Element {
  return (
    <div className={variant ? `state-message state-message--${variant}` : 'state-message'} role="status">
      {children}
    </div>
  )
}

function AccountTabBar({
  accounts,
  activeId,
  snapshots,
  onSelect
}: {
  accounts: Account[]
  activeId: string | null
  snapshots: Record<string, AccountSnapshot>
  onSelect: (id: string) => void
}): React.JSX.Element | null {
  if (accounts.length === 0) return null
  return (
    <nav className="app-tabs" role="tablist" aria-label="Accounts">
      {accounts.map((account) => (
        <button
          key={account.id}
          type="button"
          role="tab"
          className="app-tab"
          aria-selected={account.id === activeId}
          onClick={() => onSelect(account.id)}
        >
          {accountLabel(account, snapshots[account.id])}
        </button>
      ))}
    </nav>
  )
}

function AccountPanel({ snapshot }: { snapshot: AccountSnapshot | null }): React.JSX.Element {
  if (!snapshot) {
    return (
      <StateMessage>
        <div className="spinner" aria-hidden="true" />
        <span>Loading account data…</span>
      </StateMessage>
    )
  }
  return (
    <>
      <section className="panel" aria-label="Usage">
        <h2 className="panel-title">Usage</h2>
        <p className="muted">{snapshot.usage.message ?? `Status: ${snapshot.usage.status}`}</p>
      </section>
      <section className="panel" aria-label="Sessions">
        <h2 className="panel-title">Sessions</h2>
        {snapshot.sessions.length === 0 ? (
          <p className="muted">No running Claude Code sessions.</p>
        ) : (
          <p>
            {snapshot.sessions.length} watched session{snapshot.sessions.length === 1 ? '' : 's'}
          </p>
        )}
      </section>
    </>
  )
}

function App({ store = getGaugesStore() }: AppProps): React.JSX.Element {
  const status = useGauges((s) => s.status, store)
  const error = useGauges((s) => s.error, store)
  const config = useGauges((s) => s.config, store)
  const snapshots = useGauges((s) => s.snapshots, store)
  const activeAccount = useGauges(selectActiveAccount, store)
  const activeSnapshot = useGauges(selectActiveSnapshot, store)

  useEffect(() => {
    void store.init()
    return () => store.dispose()
  }, [store])

  let content: React.ReactNode
  if (status === 'loading') {
    content = (
      <StateMessage>
        <div className="spinner" aria-hidden="true" />
        <span>Loading…</span>
      </StateMessage>
    )
  } else if (status === 'error') {
    content = <StateMessage variant="error">Could not load data: {error ?? 'unknown error'}</StateMessage>
  } else if (!activeAccount) {
    content = <StateMessage>No accounts linked yet. Add a Claude config directory to get started.</StateMessage>
  } else {
    content = <AccountPanel snapshot={activeSnapshot} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          <span className="app-title-accent">Claude Code</span> Gauges
        </h1>
      </header>
      <AccountTabBar
        accounts={config?.accounts ?? []}
        activeId={activeAccount?.id ?? null}
        snapshots={snapshots}
        onSelect={(id) => void store.setActiveAccount(id)}
      />
      <main className="app-main">{content}</main>
    </div>
  )
}

export default App
