function Loader({ size = 'md', label = 'Loading', fullScreen = false }) {
  const spinner = (
    <div className={`loader loader--${size}`} role="status" aria-live="polite">
      <span className="loader__ring" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  )

  return fullScreen ? <div className="loader-overlay">{spinner}</div> : spinner
}

export default Loader
