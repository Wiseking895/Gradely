import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth.tsx'
import HomePage from './routes/HomePage.tsx'
import LoginPage from './routes/LoginPage.tsx'
import NotFoundPage from './routes/NotFoundPage.tsx'
import RegisterSchoolPage from './routes/RegisterSchoolPage.tsx'
import VerifyEmailPage from './routes/VerifyEmailPage.tsx'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register-school" element={<RegisterSchoolPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
