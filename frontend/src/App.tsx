import { BrowserRouter, Route, Routes } from 'react-router-dom'
import HomePage from './routes/HomePage.tsx'
import NotFoundPage from './routes/NotFoundPage.tsx'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}
