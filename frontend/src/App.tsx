import { BrowserRouter, Route, Routes } from 'react-router-dom'
import RequireAuth from './components/RequireAuth.tsx'
import { AuthProvider } from './lib/auth.tsx'
import DashboardEntryPage from './routes/DashboardEntryPage.tsx'
import HomePage from './routes/HomePage.tsx'
import LoginPage from './routes/LoginPage.tsx'
import NotFoundPage from './routes/NotFoundPage.tsx'
import RegisterSchoolPage from './routes/RegisterSchoolPage.tsx'
import VerifyEmailPage from './routes/VerifyEmailPage.tsx'
import ClassDetailPage from './routes/schools/ClassDetailPage.tsx'
import ClassesPage from './routes/schools/ClassesPage.tsx'
import SchoolLayout from './routes/schools/SchoolLayout.tsx'
import SchoolOverviewPage from './routes/schools/SchoolOverviewPage.tsx'
import SchoolProfilePage from './routes/schools/SchoolProfilePage.tsx'
import SubjectsPage from './routes/schools/SubjectsPage.tsx'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register-school" element={<RegisterSchoolPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <DashboardEntryPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dashboard/schools/:schoolId"
            element={
              <RequireAuth>
                <SchoolLayout />
              </RequireAuth>
            }
          >
            <Route index element={<SchoolOverviewPage />} />
            <Route path="profile" element={<SchoolProfilePage />} />
            <Route path="classes" element={<ClassesPage />} />
            <Route path="classes/:classId" element={<ClassDetailPage />} />
            <Route path="subjects" element={<SubjectsPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
