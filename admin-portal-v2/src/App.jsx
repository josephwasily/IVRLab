import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import IVRList from './pages/IVRList'
import IVREdit from './pages/IVREdit'
import IVRCreate from './pages/IVRCreate'
import Templates from './pages/Templates'
import Analytics from './pages/Analytics'
import Prompts from './pages/Prompts'
import Trunks from './pages/Trunks'
import Campaigns from './pages/Campaigns'
import CampaignEdit from './pages/CampaignEdit'
import OutboundCalls from './pages/OutboundCalls'
import Logs from './pages/Logs'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }
  
  if (!user) {
    return <Navigate to="/login" replace />
  }
  
  return children
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }>
          <Route index element={<Dashboard />} />
          <Route path="ivr" element={<IVRList />} />
          <Route path="ivr/create" element={<IVRCreate />} />
          <Route path="ivr/:id" element={<IVREdit />} />
          <Route path="templates" element={<Templates />} />
          <Route path="prompts" element={<Prompts />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="trunks" element={<Trunks />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/:id" element={<CampaignEdit />} />
          <Route path="outbound-calls" element={<OutboundCalls />} />
          <Route path="logs" element={<Logs />} />
        </Route>
      </Routes>
    </AuthProvider>
  )
}

export default App
