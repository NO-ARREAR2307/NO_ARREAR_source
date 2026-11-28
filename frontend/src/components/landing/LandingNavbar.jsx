import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../../assets/logo.png'
import useAuth from '../../hooks/useAuth.js'

const links = [
  { href: '#home', label: 'Home' },
  { href: '#features', label: 'Features' },
  { href: '#how', label: 'How it works' },
]

function LandingNavbar() {
  const [open, setOpen] = useState(false)
  const { isAuthenticated } = useAuth()

  return (
    <nav className="lnav" aria-label="Main">
      <Link to="/" className="brand">
        <img src={logo} alt="NO_ARREAR logo" className="brand__logo" />
        <span className="brand__name">NO_ARREAR</span>
      </Link>

      <ul className={`lnav__links ${open ? 'is-open' : ''}`}>
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} onClick={() => setOpen(false)}>{l.label}</a>
          </li>
        ))}
        <li className="lnav__mobile-cta">
          <Link to={isAuthenticated ? '/dashboard' : '/login'} className="pill pill--outline">
            {isAuthenticated ? 'Dashboard' : 'Login'}
          </Link>
        </li>
      </ul>

      <Link to={isAuthenticated ? '/dashboard' : '/login'} className="pill pill--outline lnav__cta">
        {isAuthenticated ? 'Dashboard' : 'Login'}
      </Link>
      <button type="button" className="icon-btn lnav__toggle" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu" aria-expanded={open}>
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
    </nav>
  )
}

export default LandingNavbar
