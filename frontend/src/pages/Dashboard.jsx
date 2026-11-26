import { ArrowRight, BadgeCheck, BookOpen, Building2, GraduationCap, Layers } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button, Card, DetailsSkeleton, ProfileState, StatCardSkeleton } from '../components/ui'
import useProfileView from '../hooks/useProfileView.js'
import { semesterLabel } from '../utils/semester.js'

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function Dashboard() {
  const view = useProfileView()
  const { user, loading } = view
  const showData = !loading && !view.failed && !view.empty
  const stats = [
    { icon: GraduationCap, label: 'Course', value: user?.course, to: '/profile#course' },
    { icon: Building2, label: 'Department', value: user?.department, to: '/profile#department' },
    { icon: Layers, label: 'Semester', value: semesterLabel(user?.semester), to: '/profile#semester' },
  ]

  return (
    <>
      <section className="welcome glass-dark">
        <div>
          <p className="eyebrow">{greeting()}</p>
          <h1 className="welcome__title">Welcome, {loading ? '…' : user?.name?.split(' ')[0] || 'student'}</h1>
          <p className="welcome__text">Your subjects for every semester are one click away.</p>
        </div>
        <Link to="/academics">
          <Button variant="secondary" size="lg">
            <BookOpen size={18} /> View my subjects <ArrowRight size={16} />
          </Button>
        </Link>
      </section>

      {(view.failed || view.empty || view.stale) && (
        <div className="section"><ProfileState view={view} /></div>
      )}

      {!view.failed && !view.empty && (
        <section className="grid grid--3">
          {loading
            ? stats.map(({ label }) => <StatCardSkeleton key={label} />)
            : stats.map(({ icon: Icon, label, value, to }) => (
                <Link key={label} to={to} className="card-link">
                  <Card className="glass glass--interactive">
                    <span className="icon-tile"><Icon size={20} /></span>
                    <p className="stat__label">{label}</p>
                    <p className={`stat__value ${value ? '' : 'muted'}`}>{value || 'Not set'}</p>
                  </Card>
                </Link>
              ))}
        </section>
      )}

      {!view.failed && !view.empty && (
        <Card
          className="glass section"
          title="Your profile"
          actions={showData && user?.emailVerified && <span className="badge badge--sm"><BadgeCheck size={14} /> Verified</span>}
        >
          {loading ? (
            <DetailsSkeleton rows={5} />
          ) : (
            <dl className="details details--row">
              <div><dt>Name</dt><dd>{user?.name || '—'}</dd></div>
              <div><dt>Email</dt><dd>{user?.email || '—'}</dd></div>
              <div><dt>Course</dt><dd>{user?.course || '—'}</dd></div>
              <div><dt>Department</dt><dd>{user?.department || '—'}</dd></div>
              <div><dt>Semester</dt><dd>{semesterLabel(user?.semester) || '—'}</dd></div>
            </dl>
          )}
        </Card>
      )}
    </>
  )
}

export default Dashboard
