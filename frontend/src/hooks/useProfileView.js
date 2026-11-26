import useAuth from './useAuth.js'

/**
 * View-state for anything that renders the student's profile.
 *  loading : the latest profile is being fetched (show skeletons – never the stale login copy)
 *  failed  : fetching failed and there is nothing saved to show (show an error with retry)
 *  stale   : fetching failed but a saved copy exists (show it with a notice)
 *  empty   : profile loaded but has no data at all
 */
export default function useProfileView() {
  const { user, profileStatus, profileError, refreshProfile } = useAuth()
  const loading = profileStatus === 'loading'
  const errored = profileStatus === 'error'
  return {
    user,
    loading,
    failed: errored && !user,
    stale: errored && Boolean(user),
    empty: !loading && !errored && !user,
    error: profileError,
    retry: refreshProfile,
  }
}
