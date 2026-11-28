import { Link, Outlet } from 'react-router-dom'
import logo from '../../assets/logo.png'
import HeroArt from '../landing/HeroArt.jsx'

/** Split screen used by login, register and verify pages: prominent brand panel + form. */
function AuthLayout() {
  return (
    <div className="auth">
      <aside className="auth__panel">
        <Link to="/" className="brand brand--lg auth__brand-row">
          <img src={logo} alt="NO_ARREAR logo" className="brand__logo" />
          <span className="brand__name">NO_ARREAR</span>
        </Link>
        <div className="auth__art" aria-hidden="true">
          <HeroArt />
        </div>
        <div className="auth__copy">
          <p className="eyebrow">Exam prep, reimagined</p>
          <h2 className="auth__tagline">
            Clear every paper.<br />
            Leave <span className="text-champagne">no arrear.</span>
          </h2>
          <p className="auth__sub">Smarter exam preparation for university students.</p>
        </div>
      </aside>
      <main className="auth__main">
        <Link to="/" className="brand brand--dark auth__mobile-brand">
          <img src={logo} alt="NO_ARREAR logo" className="brand__logo" />
          <span className="brand__name">NO_ARREAR</span>
        </Link>
        <div className="auth__card">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

export default AuthLayout
