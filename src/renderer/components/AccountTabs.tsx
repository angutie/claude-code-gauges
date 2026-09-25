import { useState } from 'react'
import type { Account, AccountSnapshot, AddAccountResult } from '../../shared/types'
import { accountLabel } from '../store'

export interface AccountTabsProps {
  accounts: Account[]
  activeId: string | null
  snapshots: Record<string, AccountSnapshot>
  onSelect: (accountId: string) => void
  /** Opens the config-directory picker in main and links the chosen dir. */
  onAdd: () => Promise<AddAccountResult>
  onRemove: (accountId: string) => Promise<void>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function AccountTabs({
  accounts,
  activeId,
  snapshots,
  onSelect,
  onAdd,
  onRemove
}: AccountTabsProps): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const handleAdd = async (): Promise<void> => {
    setAdding(true)
    setError(null)
    setConfirmingId(null)
    try {
      const result = await onAdd()
      if (!result.ok && !result.cancelled) setError(result.error)
    } catch (err) {
      setError(`Could not add the account: ${errorMessage(err)}`)
    } finally {
      setAdding(false)
    }
  }

  const handleRemove = async (accountId: string): Promise<void> => {
    setRemovingId(accountId)
    setError(null)
    try {
      await onRemove(accountId)
      setConfirmingId(null)
    } catch (err) {
      setError(`Could not remove the account: ${errorMessage(err)}`)
    } finally {
      setRemovingId(null)
    }
  }

  const confirming = accounts.find((a) => a.id === confirmingId) ?? null

  return (
    <div className="account-tabs">
      <nav className="app-tabs" role="tablist" aria-label="Accounts">
        {accounts.map((account) => {
          const label = accountLabel(account, snapshots[account.id])
          return (
            <div key={account.id} className="account-tab">
              <button
                type="button"
                role="tab"
                className="app-tab"
                aria-selected={account.id === activeId}
                title={account.configDir}
                onClick={() => onSelect(account.id)}
              >
                {label}
              </button>
              <button
                type="button"
                className="account-tab-remove"
                aria-label={`Remove account ${label}`}
                title="Remove account"
                disabled={removingId !== null}
                onClick={() => {
                  setError(null)
                  setConfirmingId(account.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          type="button"
          className="app-tab account-tab-add"
          onClick={() => void handleAdd()}
          disabled={adding}
        >
          {adding ? 'Adding…' : '+ Add account'}
        </button>
      </nav>

      {confirming && (
        <div className="account-tabs-confirm" role="alertdialog" aria-label="Confirm account removal">
          <span>
            Remove <strong>{accountLabel(confirming, snapshots[confirming.id])}</strong>? Its config directory is
            not deleted.
          </span>
          <button
            type="button"
            className="button button--danger"
            disabled={removingId !== null}
            onClick={() => void handleRemove(confirming.id)}
          >
            {removingId === confirming.id ? 'Removing…' : 'Remove'}
          </button>
          <button type="button" className="button" onClick={() => setConfirmingId(null)}>
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="account-tabs-error" role="alert">
          <span>{error}</span>
          <button type="button" className="button" aria-label="Dismiss error" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
