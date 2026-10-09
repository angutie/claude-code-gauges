import { useEffect, useState } from 'react'
import { WIDGET_KEYS, type AccountSnapshot, type WatchedSessions, type WidgetToggles } from '../shared/types'
import { AccountTabs } from './components/AccountTabs'
import { HelpPanel } from './components/HelpPanel'
import { SessionList } from './components/SessionList'
import { SessionPicker } from './components/SessionPicker'
import { SettingsPanel } from './components/SettingsPanel'
import { StateMessage } from './components/StateMessage'
import { UsagePanel } from './components/UsageGauge'
import { MiniApp } from './mini/MiniApp'
import {
  getGaugesStore,
  selectActiveAccount,
  selectActiveSnapshot,
  useGauges,
  type GaugesStore
} from './store'
import './styles.css'

const DEFAULT_WIDGETS = Object.fromEntries(WIDGET_KEYS.map((key) => [key, true])) as WidgetToggles

interface AppProps {
  store?: GaugesStore
}

/** The panel shown above the content. Settings and Help are mutually exclusive. */
export type HeaderPanel = 'settings' | 'help' | null

/** Closes `panel` if it is already open; otherwise opens it in place of whichever panel was open. */
export function toggleHeaderPanel(current: HeaderPanel, panel: Exclude<HeaderPanel, null>): HeaderPanel {
  return current === panel ? null : panel
}

export interface AppHeaderProps {
  openPanel: HeaderPanel
  /** Settings needs a loaded config, so its button shows only when this is true. Help always shows. */
  showSettings: boolean
  onToggle: (panel: Exclude<HeaderPanel, null>) => void
}

export function AppHeader({ openPanel, showSettings, onToggle }: AppHeaderProps): React.JSX.Element {
  return (
    <header className="app-header">
      <h1 className="app-title">
        <span className="app-title-accent">Claude Code</span> Gauges
      </h1>
      <div className="app-header-actions">
        <button
          type="button"
          className="button"
          aria-expanded={openPanel === 'help'}
          onClick={() => onToggle('help')}
        >
          Help
        </button>
        {showSettings && (
          <button
            type="button"
            className="button"
            aria-expanded={openPanel === 'settings'}
            onClick={() => onToggle('settings')}
          >
            Settings
          </button>
        )}
      </div>
    </header>
  )
}

function AccountPanel({
  snapshot,
  widgets,
  watched,
  onWatchedChange
}: {
  snapshot: AccountSnapshot | null
  widgets: WidgetToggles
  watched: WatchedSessions | undefined
  onWatchedChange: (watched: WatchedSessions) => void
}): React.JSX.Element {
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
      <UsagePanel usage={snapshot.usage} widgets={widgets} tokenStatus={snapshot.identity?.tokenStatus} />
      {widgets.sessions && (
        <SessionPicker sessions={snapshot.availableSessions} watched={watched} onChange={onWatchedChange} />
      )}
      <SessionList sessions={snapshot.sessions} widgets={widgets} />
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
  const [openPanel, setOpenPanel] = useState<HeaderPanel>(null)
  const closePanel = (): void => setOpenPanel(null)

  useEffect(() => {
    void store.init()
    return () => store.dispose()
  }, [store])

  // The mini window has its own shell; the max layout below is unchanged.
  if (config?.windowMode === 'mini') return <MiniApp store={store} />

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
    content = <StateMessage>No accounts linked yet. Use “Add account” to pick a Claude config directory.</StateMessage>
  } else {
    const accountId = activeAccount.id
    content = (
      <AccountPanel
        snapshot={activeSnapshot}
        widgets={config?.widgets ?? DEFAULT_WIDGETS}
        watched={config?.watchedSessionIds[accountId]}
        onWatchedChange={(watched) => {
          const current = store.getState().config?.watchedSessionIds ?? {}
          void store.setConfig({ watchedSessionIds: { ...current, [accountId]: watched } })
        }}
      />
    )
  }

  return (
    <div className="app">
      <AppHeader
        openPanel={openPanel}
        showSettings={status === 'ready' && config !== null}
        onToggle={(panel) => setOpenPanel((current) => toggleHeaderPanel(current, panel))}
      />
      {status === 'ready' && (
        <AccountTabs
          accounts={config?.accounts ?? []}
          activeId={activeAccount?.id ?? null}
          snapshots={snapshots}
          onSelect={(id) => void store.setActiveAccount(id)}
          onAdd={() => store.api.addAccount()}
          onRemove={async (id) => {
            await store.api.removeAccount(id)
          }}
        />
      )}
      <main className="app-main">
        {openPanel === 'settings' && status === 'ready' && config && (
          <SettingsPanel
            config={config}
            onChange={(patch) => void store.setConfig(patch)}
            onClose={closePanel}
          />
        )}
        {openPanel === 'help' && <HelpPanel onClose={closePanel} />}
        {content}
      </main>
    </div>
  )
}

export default App
