import { BadgeCheck, Building2, GraduationCap, Mail, ShieldCheck, User } from 'lucide-react'
import { Card, DetailsSkeleton, ProfileState } from '../ui'
import useProfileView from '../../hooks/useProfileView.js'
import { humanize } from '../../utils/academic.js'

const Value = ({ children }) => (children ? <dd>{children}</dd> : <dd className="muted">Not assigned</dd>)

/** Role label from the user object (`role` or the first of `roles`). */
const roleLabel = (user) => humanize(user?.role || (Array.isArray(user?.roles) ? user.roles[0] : ''))

/**
 * The signed-in admin's own details. Only the logged-in user's record is read, and no student-only data
 * (such as a semester) is shown. Missing fields read "Not assigned".
 */
function AdminProfileCard({ title = 'Admin profile' }) {
  const view = useProfileView()
  const { user, loading } = view
  const showData = !loading && !view.failed && !view.empty

  return (
    <Card
      className="glass"
      title={title}
      actions={showData && user?.emailVerified && <span className="badge badge--sm"><BadgeCheck size={14} /> Verified</span>}
    >
      {loading ? (
        <DetailsSkeleton rows={5} />
      ) : (
        <ProfileState view={view}>
          {showData && (
            <dl className="details details--row">
              <div><dt><User size={13} /> Name</dt><Value>{user?.name}</Value></div>
              <div><dt><Mail size={13} /> Email</dt><Value>{user?.email}</Value></div>
              <div><dt><ShieldCheck size={13} /> Role</dt><Value>{roleLabel(user)}</Value></div>
              <div><dt><GraduationCap size={13} /> Assigned course</dt><Value>{user?.course}</Value></div>
              <div><dt><Building2 size={13} /> Assigned department</dt><Value>{user?.department}</Value></div>
            </dl>
          )}
        </ProfileState>
      )}
    </Card>
  )
}

export default AdminProfileCard
