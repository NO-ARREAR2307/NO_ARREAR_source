import { ArrowRight, BadgeCheck, Building2, GraduationCap, Layers, Mail, User } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Button, Card, DetailsSkeleton, ProfileState } from '../components/ui'
import useProfileView from '../hooks/useProfileView.js'
import { semesterLabel } from '../utils/semester.js'

const Value = ({ children }) => (children ? <dd>{children}</dd> : <dd className="muted">Not set</dd>)

/** Profile page. Sections carry ids (#personal, #course, #department, #semester) that the sidebar links to. */
function Profile() {
  const view = useProfileView()
  const { user, loading } = view
  const { hash } = useLocation()

  // Scroll to the section named in the URL once its content is on screen.
  useEffect(() => {
    if (!hash || loading) return
    document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [hash, loading])

  const showData = !loading && !view.failed && !view.empty

  return (
    <>
      <header className="page-head">
        <h1 className="page-head__title">My Information</h1>
        <p className="muted">Your profile, course, department and semester.</p>
      </header>

      <Card
        id="personal"
        className="glass"
        title="Profile"
        actions={showData && user?.emailVerified && <span className="badge badge--sm"><BadgeCheck size={14} /> Verified</span>}
      >
        {loading ? (
          <DetailsSkeleton rows={2} />
        ) : (
          <ProfileState view={view}>
            {showData && (
              <dl className="details details--row">
                <div><dt><User size={13} /> Name</dt><Value>{user?.name}</Value></div>
                <div><dt><Mail size={13} /> Email</dt><Value>{user?.email}</Value></div>
              </dl>
            )}
          </ProfileState>
        )}
      </Card>

      <Card
        className="glass section"
        title="Course, department & semester"
        actions={
          showData && (
            <Link to="/academics">
              <Button size="sm" variant="outline">Change semester <ArrowRight size={14} /></Button>
            </Link>
          )
        }
      >
        {loading ? (
          <DetailsSkeleton rows={3} />
        ) : (
          showData && (
            <dl className="info-grid">
              <div id="course" className="info-tile">
                <span className="icon-tile"><GraduationCap size={20} /></span>
                <dt>Course</dt><Value>{user?.course}</Value>
              </div>
              <div id="department" className="info-tile">
                <span className="icon-tile"><Building2 size={20} /></span>
                <dt>Department</dt><Value>{user?.department}</Value>
              </div>
              <div id="semester" className="info-tile">
                <span className="icon-tile"><Layers size={20} /></span>
                <dt>Semester</dt><Value>{semesterLabel(user?.semester)}</Value>
              </div>
            </dl>
          )
        )}
        {!loading && view.failed && <ProfileState view={view} />}
      </Card>
    </>
  )
}

export default Profile
