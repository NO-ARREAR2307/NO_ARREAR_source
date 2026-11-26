/** Role helpers. The backend attaches the role to the user object returned at login / by GET /auth/profile. */
export const ADMIN_ROLE = 'admin'

const norm = (v) => String(v ?? '').trim().toLowerCase()

/** True when the user has the given role (supports `role: 'admin'` and `roles: ['admin']`). */
export function hasRole(user, role) {
  if (!user) return false
  const wanted = norm(role)
  if (norm(user.role) === wanted) return true
  return Array.isArray(user.roles) && user.roles.some((r) => norm(r) === wanted)
}

export const isAdmin = (user) => hasRole(user, ADMIN_ROLE)
