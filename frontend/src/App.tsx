import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { AgentConsole } from './pages/AgentConsole'
import { Home } from './pages/Home'
import { Login } from './pages/Login'
import { Settings } from './pages/Settings'
import { Signup } from './pages/Signup'
import { RequireAuth, RequireGuest } from './routes/AuthGuard'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route
            path="/login"
            element={
              <RequireGuest>
                <Login />
              </RequireGuest>
            }
          />
          <Route
            path="/signup"
            element={
              <RequireGuest>
                <Signup />
              </RequireGuest>
            }
          />
          <Route
            path="/"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route
            path="/c/:conversationId"
            element={
              <RequireAuth>
                <Home />
              </RequireAuth>
            }
          />
          <Route
            path="/agents"
            element={
              <RequireAuth>
                <AgentConsole />
              </RequireAuth>
            }
          />
          <Route
            path="/settings"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
