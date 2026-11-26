import { Route, Routes } from 'react-router-dom'
import AuthLayout from '../components/auth/AuthLayout.jsx'
import AppLayout from '../components/layout/AppLayout.jsx'
import Academics from '../pages/Academics.jsx'
import AdminDashboard from '../pages/AdminDashboard.jsx'
import AdminProfile from '../pages/AdminProfile.jsx'
import Dashboard from '../pages/Dashboard.jsx'
import ForgotPassword from '../pages/ForgotPassword.jsx'
import GenerateQuestions from '../pages/GenerateQuestions.jsx'
import Home from '../pages/Home.jsx'
import Landing from '../pages/Landing.jsx'
import Login from '../pages/Login.jsx'
import Materials from '../pages/Materials.jsx'
import Profile from '../pages/Profile.jsx'
import NotFound from '../pages/NotFound.jsx'
import Register from '../pages/Register.jsx'
import SavedQuestions from '../pages/SavedQuestions.jsx'
import SharedMaterial from '../pages/SharedMaterial.jsx'
import SubjectDetails from '../pages/SubjectDetails.jsx'
import VerifyEmail from '../pages/VerifyEmail.jsx'
import { GuestRoute, ProtectedRoute, RoleRoute } from './ProtectedRoute.jsx'
import RoleView from './RoleView.jsx'

function AppRoutes() {
  return (
    <Routes>
      <Route index element={<Landing />} />

      <Route element={<AuthLayout />}>
        <Route element={<GuestRoute />}>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
        </Route>
        <Route path="verify-email" element={<VerifyEmail />} />
      </Route>

      {/* Public share links: no login, outside the protected layout */}
      <Route path="shared/materials/:token" element={<SharedMaterial />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<RoleView admin={<AdminDashboard />} student={<Dashboard />} />} />
          <Route path="profile" element={<RoleView admin={<AdminProfile />} student={<Profile />} />} />
          <Route path="academics" element={<Academics />} />
          <Route path="materials" element={<Materials />} />
          <Route path="generate-questions" element={<GenerateQuestions />} />
          <Route path="saved-questions" element={<SavedQuestions />} />
          <Route path="academics/semesters/:semesterId/subjects/:subjectId" element={<SubjectDetails />} />
          <Route element={<RoleRoute roles={['admin']} />}>
            <Route path="components" element={<Home />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<div className="container"><NotFound /></div>} />
    </Routes>
  )
}

export default AppRoutes
