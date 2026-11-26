import { ArrowRight, BookOpen, Layers, ShieldCheck, User } from 'lucide-react'
import { Link } from 'react-router-dom'
import AdminOverview from '../components/admin/AdminOverview.jsx'
import AdminProfileCard from '../components/admin/AdminProfileCard.jsx'
import { Button, Card } from '../components/ui'
import useAdminOverview from '../hooks/useAdminOverview.js'
import useProgrammeCount from '../hooks/useProgrammeCount.js'
import useAuth from '../hooks/useAuth.js'

// Shortcuts point only at pages that exist today. Student/course management needs backend admin endpoints first.
const shortcuts = [
  { to: '/academics', icon: BookOpen, title: 'Academic catalogue', text: 'Browse universities, departments, semesters and subjects.' },
  { to: '/components', icon: Layers, title: 'Components', text: 'Open the admin-only UI component library.' },
  { to: '/profile', icon: User, title: 'My profile', text: 'View your admin account details.' },
]

/** Dashboard shown to admins instead of the student dashboard. */
function AdminDashboard() {
  const { user, initializing } = useAuth()
  // Wait until the stored session has been verified so metrics are never requested with an unverified role.
  const overview = useAdminOverview(!initializing)
  const programmes = useProgrammeCount(!initializing)

  return (
    <>
      <section className="welcome glass-dark">
        <div>
          <p className="eyebrow">Admin</p>
          <h1 className="welcome__title">Admin overview{user?.name ? `, ${user.name.split(' ')[0]}` : ''}</h1>
          <p className="welcome__text">Totals are counted live from the database.</p>
        </div>
        <Link to="/academics">
          <Button variant="secondary" size="lg">
            <ShieldCheck size={18} /> Academic catalogue <ArrowRight size={16} />
          </Button>
        </Link>
      </section>

      <AdminOverview overview={overview} programmes={programmes} />

      <Card className="glass section" title="Management shortcuts">
        <div className="grid grid--3">
          {shortcuts.map(({ to, icon: Icon, title, text }) => (
            <Link key={to} to={to} className="card-link shortcut">
              <span className="icon-tile"><Icon size={20} /></span>
              <span className="shortcut__text">
                <strong>{title}</strong>
                <span className="muted">{text}</span>
              </span>
            </Link>
          ))}
        </div>
      </Card>

      <div className="section">
        <AdminProfileCard />
      </div>
    </>
  )
}

export default AdminDashboard
