import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useCallback } from 'react'
import Login from './pages/Login'
import BrainView from './pages/BrainView'
import Chat from './pages/Chat'
import SelfDialogue from './pages/SelfDialogue'
import Goals from './pages/Goals'
import SandboxHistory from './pages/SandboxHistory'
import PersonalityConfig from './pages/PersonalityConfig'
import UserManagement from './pages/UserManagement'
import NetworkView from './pages/NetworkView'
import SkillsView from './pages/SkillsView'
import MarketplacePage from './pages/MarketplacePage'
import UpdatePage from './pages/UpdatePage'
import ReportsPage from './pages/ReportsPage'
import Settings from './pages/Settings'
import CalendarPage from './pages/CalendarPage'
import { useWebSocket } from './hooks/useWebSocket'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import type { WsMessage } from './types'
import Layout from './components/Layout'

function ProtectedApp() {
  const [notification, setNotification] = useState<string | null>(null)
  const role = localStorage.getItem('vantis_role') || 'user'

  const handleWs = useCallback((msg: WsMessage) => {
    if (msg.type === 'notification') {
      const data = msg.data as { message: string }
      setNotification(data.message)
      setTimeout(() => setNotification(null), 8000)
    }
    if (msg.type === 'evolution_proposal') {
      const d = msg.data as { auto_applied?: boolean; version?: number }
      const txt = d?.auto_applied
        ? `Personality evolved to v${d.version ?? '?'}. Changes are live.`
        : 'VANTIS has proposed a personality evolution. Review in the Personality panel.'
      setNotification(txt)
      setTimeout(() => setNotification(null), 12000)
    }
  }, [])

  useWebSocket(handleWs)
  useKeyboardShortcuts()

  return (
    <Layout role={role} notification={notification}>
      <Routes>
        <Route path="/brain" element={<BrainView />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/monologue" element={<SelfDialogue />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/sandbox" element={<SandboxHistory />} />
        <Route path="/admin/network" element={<NetworkView />} />
        <Route path="/admin/personality" element={<PersonalityConfig />} />
        <Route path="/admin/users" element={<UserManagement />} />
        <Route path="/skills" element={<SkillsView />} />
        <Route path="/marketplace" element={<MarketplacePage />} />
        <Route path="/admin/update" element={<UpdatePage />} />
        <Route path="/admin/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="*" element={<Navigate to="/brain" replace />} />
      </Routes>
    </Layout>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem('vantis_token')
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <ProtectedApp />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  )
}
