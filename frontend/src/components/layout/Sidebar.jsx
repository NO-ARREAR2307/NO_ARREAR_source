import { Bookmark, BookOpen, FolderOpen, Layers, LayoutDashboard, Sparkles, User, X } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import useAuth from '../../hooks/useAuth.js'
import { isAdmin } from '../../utils/roles.js'

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/academics', label: 'Academics', icon: BookOpen },
  { to: '/materials', label: 'Study Materials', icon: FolderOpen },
  { to: '/generate-questions', label: 'Generate Questions', icon: Sparkles },
  { to: '/saved-questions', label: 'Saved Questions', icon: Bookmark },
  { to: '/components', label: 'Components', icon: Layers, adminOnly: true },
]

function Sidebar({ isOpen, onClose }) {
  const { user } = useAuth()
  const visibleLinks = links.filter((link) => !link.adminOnly || isAdmin(user))

  return (
    <>
      <div className={`sidebar-scrim ${isOpen ? 'is-visible' : ''}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar glass-sidebar ${isOpen ? 'is-open' : ''}`} aria-label="Primary">
        <div className="sidebar__head">
          <span className="sidebar__title">Menu</span>
          <button type="button" className="icon-btn sidebar__close" onClick={onClose} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar__nav">
          {visibleLinks.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) => `sidebar__link ${isActive ? 'is-active' : ''}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <p className="sidebar__foot">NO_ARREAR · v0.1</p>
      </aside>
    </>
  )
}

export default Sidebar
