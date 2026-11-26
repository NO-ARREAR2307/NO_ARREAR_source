import { BookOpen, Building2, GraduationCap, Users } from 'lucide-react'
import { Alert, Button, Card, StatCardSkeleton } from '../ui'

const isCount = (n) => typeof n === 'number' && Number.isFinite(n)
const format = (n) => n.toLocaleString()

/** One metric card: skeleton while loading, the real API value, or an honest placeholder when it is missing. */
function MetricCard({ icon: Icon, label, loading, value, failed, unavailableReason, emptyLabel = 'Unavailable' }) {
  if (loading) return <StatCardSkeleton />

  let body
  if (failed) {
    body = (
      <>
        <p className="stat__value muted">—</p>
        <p className="stat__note">Could not be loaded.</p>
      </>
    )
  } else if (isCount(value)) {
    body = <p className="stat__value">{format(value)}</p>
  } else {
    body = (
      <>
        <p className="stat__value muted">{emptyLabel}</p>
        {unavailableReason && <p className="stat__note">{unavailableReason}</p>}
      </>
    )
  }

  return (
    <Card className="glass">
      <span className="icon-tile"><Icon size={20} /></span>
      <p className="stat__label">{label}</p>
      {body}
    </Card>
  )
}

/** The four admin totals. Students, departments and subjects come from GET /api/admin/stats; courses is the distinct programme count. */
function AdminOverview({ overview, programmes }) {
  const { loading, data, error, reload } = overview
  const failed = Boolean(error)

  return (
    <section aria-label="Overview">
      {error && (
        <div className="section">
          <Alert variant="error">{error}</Alert>
          <Button size="sm" variant="outline" onClick={reload}>Try again</Button>
        </div>
      )}
      <div className="grid grid--4 section">
        <MetricCard icon={Users} label="Total students" loading={loading} failed={failed} value={data?.totalStudents} />
        <MetricCard
          icon={GraduationCap}
          label="Total courses"
          loading={programmes.loading}
          value={programmes.value}
          emptyLabel="N/A"
          unavailableReason="Programme count could not be determined accurately."
        />
        <MetricCard icon={Building2} label="Total departments" loading={loading} failed={failed} value={data?.totalDepartments} />
        <MetricCard icon={BookOpen} label="Total subjects" loading={loading} failed={failed} value={data?.totalSubjects} />
      </div>
    </section>
  )
}

export default AdminOverview
