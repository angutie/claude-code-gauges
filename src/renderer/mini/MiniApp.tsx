import type { Account, AccountSnapshot, AppConfig } from '../../shared/types'
import { SessionList } from '../components/SessionList'
import { SettingsPanel, WindowModeToggle } from '../components/SettingsPanel'
import { StateMessage } from '../components/StateMessage'
import { UsagePanel } from '../components/UsageGauge'
import {
  accountLabel,
  getGaugesStore,
  selectActiveAccount,
  selectActiveSnapshot,
  useGauges,
  type GaugesStore
} from '../store'
import { Carousel, type CarouselScreen } from './Carousel'
import { Playground } from './Playground'

/**
 * Mini (1:1) window shell: a thin drag strip plus the infinite carousel of condensed screens.
 * The store is initialised by App; MiniApp only reads from it. React types only (no DOM lib),
 * because the node tsconfig includes `src/renderer/mini/**`.
 */

/** A carousel screen that may be restricted to the mini window. */
export interface MiniScreen extends CarouselScreen {
  /** Only reachable in mini mode (the max layout never renders it). */
  miniOnly?: boolean
}

/** Screen ids in carousel order. */
export const MINI_SCREEN_IDS = ['gauges', 'sessions', 'settings', 'playground'] as const

export interface MiniScreensInput {
  config: AppConfig
  snapshot: AccountSnapshot | null
  onConfigChange: (patch: Partial<AppConfig>) => void
}

function LoadingAccount(): React.JSX.Element {
  return (
    <StateMessage>
      <div className="spinner" aria-hidden="true" />
      <span>Loading account data…</span>
    </StateMessage>
  )
}

/** Builds the mini carousel screens: Gauges → Sessions → Settings → Playground. */
export function miniScreens({ config, snapshot, onConfigChange }: MiniScreensInput): MiniScreen[] {
  const { widgets } = config
  return [
    {
      id: 'gauges',
      label: 'Gauges',
      render: () =>
        snapshot ? (
          <UsagePanel
            usage={snapshot.usage}
            widgets={widgets}
            tokenStatus={snapshot.identity?.tokenStatus}
            compact
          />
        ) : (
          <LoadingAccount />
        )
    },
    {
      id: 'sessions',
      label: 'Sessions',
      render: () => {
        if (!snapshot) return <LoadingAccount />
        if (!widgets.sessions) return <StateMessage>Session list is turned off in Settings.</StateMessage>
        return <SessionList sessions={snapshot.sessions} widgets={widgets} compact />
      }
    },
    {
      id: 'settings',
      label: 'Settings',
      render: () => <SettingsPanel config={config} onChange={onConfigChange} compact />
    },
    {
      id: 'playground',
      label: 'Playground',
      miniOnly: true,
      render: () => <Playground sessions={snapshot?.sessions ?? []} />
    }
  ]
}

/** Screens available in a window mode; mini-only screens are dropped outside mini mode. */
export function screensForMode(screens: readonly MiniScreen[], mode: AppConfig['windowMode']): MiniScreen[] {
  return mode === 'mini' ? [...screens] : screens.filter((screen) => !screen.miniOnly)
}

export interface MiniAppProps {
  store?: GaugesStore
}

/** Root of the mini window. */
export function MiniApp({ store = getGaugesStore() }: MiniAppProps): React.JSX.Element {
  const status = useGauges((s) => s.status, store)
  const error = useGauges((s) => s.error, store)
  const config = useGauges((s) => s.config, store)
  const activeAccount: Account | null = useGauges(selectActiveAccount, store)
  const activeSnapshot = useGauges(selectActiveSnapshot, store)

  const onConfigChange = (patch: Partial<AppConfig>): void => void store.setConfig(patch)
  // Without the Settings screen the user still needs a way back to the max window.
  const backToMax = (
    <WindowModeToggle mode="mini" onChange={(windowMode) => onConfigChange({ windowMode })} />
  )

  let content: React.ReactNode
  if (status === 'error') {
    content = (
      <StateMessage variant="error">
        <span>Could not load data: {error ?? 'unknown error'}</span>
        {backToMax}
      </StateMessage>
    )
  } else if (status === 'loading' || !config) {
    content = (
      <StateMessage>
        <div className="spinner" aria-hidden="true" />
        <span>Loading…</span>
      </StateMessage>
    )
  } else if (!activeAccount) {
    content = (
      <StateMessage>
        <span>No accounts linked yet. Switch to max to add one.</span>
        {backToMax}
      </StateMessage>
    )
  } else {
    const screens = miniScreens({ config, snapshot: activeSnapshot, onConfigChange })
    content = <Carousel screens={screensForMode(screens, 'mini')} label="Mini screens" />
  }

  return (
    <div className="app mini">
      <div className="mini-drag-strip">
        {activeAccount && (
          <span className="mini-account-label" title={accountLabel(activeAccount, activeSnapshot)}>
            {accountLabel(activeAccount, activeSnapshot)}
          </span>
        )}
      </div>
      <main className="mini-main">{content}</main>
    </div>
  )
}

export default MiniApp
