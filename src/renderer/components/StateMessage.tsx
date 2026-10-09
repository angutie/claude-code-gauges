/** Centered status line for loading / error / empty states. */
export function StateMessage({
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

export default StateMessage
