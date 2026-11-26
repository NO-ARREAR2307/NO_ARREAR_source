import { Link } from 'react-router-dom'

function CallToAction() {
  return (
    <section className="cta">
      <h2>Ready to leave no arrear behind?</h2>
      <p>Create your free student account in under a minute.</p>
      <Link to="/register" className="pill pill--dark">Get Started</Link>
    </section>
  )
}

export default CallToAction
