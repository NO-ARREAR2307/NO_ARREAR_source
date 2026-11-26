import Alert from './Alert.jsx'
import StatusMessage from './StatusMessage.jsx'

/** Shared error / empty / stale handling for profile-driven sections. Returns null when the data can be shown. */
function ProfileState({ view, children }) {
  if (view.failed) {
    return <StatusMessage state="error" title="Couldn’t load your profile" text={view.error} onRetry={view.retry} />
  }
  if (view.empty) {
    return <StatusMessage state="empty" title="No profile data" text="We couldn’t find any details for your account yet." />
  }
  return (
    <>
      {view.stale && <Alert variant="info">Couldn’t refresh your profile ({view.error}). Showing the last saved details.</Alert>}
      {children}
    </>
  )
}

export default ProfileState
