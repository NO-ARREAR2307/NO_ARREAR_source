import { LogOut, Menu } from 'lucide-react'
import { Link } from 'react-router-dom'
import logo from '../../assets/logo.png'
import useAuth from '../../hooks/useAuth.js'
import Button from '../ui/Button.jsx'

function Navbar({ onMenuClick }) {
  const { user, logout } = useAuth()

  return (
    <header className="navbar">
      <div className="navbar__left">
        <button type="button" className="icon-btn navbar__menu" onClick={onMenuClick} aria-label="Open navigation">
          <Menu size={20} />
        </button>
        <Link to="/dashboard" className="brand">
          <img src={logo} alt="NO_ARREAR logo" className="brand__logo" />
          <span className="brand__name">NO_ARREAR</span>
        </Link>
      </div>
      <div className="navbar__right">
        {user?.name && <span className="navbar__user">{user.name}</span>}
        <Button size="sm" variant="outline" className="btn--on-dark" onClick={logout}>
          <LogOut size={16} /> Logout
        </Button>
      </div>
    </header>
  )
}

export default Navbar
