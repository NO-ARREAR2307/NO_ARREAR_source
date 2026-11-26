import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import HeroArt from './HeroArt.jsx'
import LandingNavbar from './LandingNavbar.jsx'

function Hero() {
  return (
    <header className="hero-card" id="home">
      <LandingNavbar />
      <div className="hero-card__grid">
        <div className="hero-card__copy">
          <p className="eyebrow">Exam prep, reimagined</p>
          <h1 className="hero-card__title">Clear every paper. Leave no arrear.</h1>
          <p className="hero-card__text">
            NO_ARREAR brings previous-year papers, important questions and AI-assisted answers together, so
            you can prepare smarter and walk into every exam confident.
          </p>
          <div className="hero-card__actions">
            <Link to="/register" className="pill pill--crimson">
              Get Started <ArrowRight size={16} />
            </Link>
            <Link to="/login" className="pill pill--champagne">Login</Link>
          </div>
        </div>
        <div className="hero-card__art">
          <HeroArt />
        </div>
      </div>
    </header>
  )
}

export default Hero
