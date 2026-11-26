import { Navigate, Outlet, useLocation } from 'react-router-dom'
import Loader from '../components/ui/Loader.jsx'
import useAuth from '../hooks/useAuth.js'
import { hasRole } from '../utils/roles.js'

/** Requires a logged-in user; otherwise redirects to /login and remembers where they were going. */
export function ProtectedRoute() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()

  // Protected pages render straight away and show skeletons while the profile is verified/loaded.
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/** For login/register: logged-in users are sent to the dashboard instead. */
export function GuestRoute() {
  const { isAuthenticated, initializing } = useAuth()

  if (initializing) return <Loader fullScreen />
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

/**
 * Requires a logged-in user with one of the given roles (e.g. <RoleRoute roles={['admin']} />).
 * Signed-out visitors go to /login; signed-in users without the role are sent to the dashboard.
 */
export function RoleRoute({ roles }) {
  const { isAuthenticated, initializing, user } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  // Wait for the stored token/profile to be verified so a stale role never grants (or denies) access.
  if (initializing) return <Loader fullScreen />
  if (!roles.some((role) => hasRole(user, role))) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
