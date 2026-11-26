import useAuth from '../hooks/useAuth.js'
import { isAdmin } from '../utils/roles.js'

/** Renders `admin` for admin users and `student` for everyone else, so each role keeps its own page at one URL. */
function RoleView({ admin, student }) {
  const { user } = useAuth()
  return isAdmin(user) ? admin : student
}

export default RoleView
