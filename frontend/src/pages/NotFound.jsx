import { Link } from 'react-router-dom'
import { Button } from '../components/ui'

function NotFound() {
  return (
    <div className="not-found">
      <p className="not-found__code">404</p>
      <h1>Page not found</h1>
      <p className="muted">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link to="/">
        <Button>Back to home</Button>
      </Link>
    </div>
  )
}

export default NotFound
