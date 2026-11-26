import AdminProfileCard from '../components/admin/AdminProfileCard.jsx'

/** /profile for admins: their own account details only (the student Profile page is unchanged). */
function AdminProfile() {
  return (
    <>
      <header className="page-head">
        <h1 className="page-head__title">My Information</h1>
        <p className="muted">Your admin account details.</p>
      </header>
      <AdminProfileCard title="Admin profile" />
    </>
  )
}

export default AdminProfile
