import React, { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

// ── Code-split page components ──────────────────────────────────────────
// Each page is loaded only when its route is visited, reducing the initial
// bundle from ~1.3 MB to ~200–300 KB.

const Login = React.lazy(() => import('./pages/Login.jsx'));

const AgentDashboard = React.lazy(() => import('./pages/agent/Dashboard.jsx'));
const BlastDashboard = React.lazy(() => import('./pages/agent/BlastDashboard.jsx'));
const History = React.lazy(() => import('./pages/agent/History.jsx'));
const AgentTemplates = React.lazy(() => import('./pages/agent/Templates.jsx'));
const AgentInbound = React.lazy(() => import('./pages/agent/Inbound.jsx'));
const Gateway = React.lazy(() => import('./pages/agent/Gateway.jsx'));

const AdminDashboard = React.lazy(() => import('./pages/admin/Dashboard.jsx'));
const Campaigns = React.lazy(() => import('./pages/admin/Campaigns.jsx'));
const AdminTemplates = React.lazy(() => import('./pages/admin/Templates.jsx'));
const AdminInbound = React.lazy(() => import('./pages/admin/Inbound.jsx'));
const AdminAgents = React.lazy(() => import('./pages/admin/AdminAgents.jsx'));
const Admins = React.lazy(() => import('./pages/admin/Agents.jsx'));
const Numbers = React.lazy(() => import('./pages/admin/Numbers.jsx'));
const Webhooks = React.lazy(() => import('./pages/admin/Webhooks.jsx'));
const Activity = React.lazy(() => import('./pages/admin/Activity.jsx'));
const AdminAnalytics = React.lazy(() => import('./pages/admin/Analytics.jsx'));
const AdminContacts = React.lazy(() => import('./pages/admin/Contacts.jsx'));
const Settings = React.lazy(() => import('./pages/admin/Settings.jsx'));
const Recipients = React.lazy(() => import('./pages/agent/Recipients.jsx'));

// ── Route guards ───────────────────────────────────────────────────────

function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin' || user.role === 'super_admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, color: '#737373', fontFamily: 'Inter, sans-serif' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, color: '#737373', fontFamily: 'Inter, sans-serif' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin' && user.role !== 'super_admin') return <Navigate to="/compose" replace />;
  return children;
}

function AgentRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, color: '#737373', fontFamily: 'Inter, sans-serif' }}>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin' || user.role === 'super_admin') return <Navigate to="/admin" replace />;
  return children;
}

// ── Page loading spinner ───────────────────────────────────────────────

function PageFallback() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: '#737373',
      fontSize: 14,
      gap: 12,
      background: '#f5f5f5',
    }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 0.8s linear infinite' }}>
        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
        <path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
      Loading…
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── App ────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><RoleRedirect /></ProtectedRoute>} />
            <Route path="/dashboard" element={<AgentRoute><AgentDashboard /></AgentRoute>} />
            <Route path="/compose" element={<AgentRoute><BlastDashboard /></AgentRoute>} />
            <Route path="/history" element={<AgentRoute><History /></AgentRoute>} />
            <Route path="/templates" element={<AgentRoute><AgentTemplates /></AgentRoute>} />
            <Route path="/inbound" element={<AgentRoute><AgentInbound /></AgentRoute>} />
            <Route path="/gateway" element={<AgentRoute><Gateway /></AgentRoute>} />
            <Route path="/recipients" element={<AgentRoute><Recipients /></AgentRoute>} />
            <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/admin/campaigns" element={<AdminRoute><Campaigns /></AdminRoute>} />
            <Route path="/admin/templates" element={<AdminRoute><AdminTemplates /></AdminRoute>} />
            <Route path="/admin/inbound" element={<AdminRoute><AdminInbound /></AdminRoute>} />
            <Route path="/admin/agents" element={<AdminRoute><AdminAgents /></AdminRoute>} />
            <Route path="/admin/admins" element={<AdminRoute><Admins /></AdminRoute>} />
            <Route path="/admin/numbers" element={<AdminRoute><Numbers /></AdminRoute>} />
            <Route path="/admin/webhooks" element={<AdminRoute><Webhooks /></AdminRoute>} />
            <Route path="/admin/activity" element={<AdminRoute><Activity /></AdminRoute>} />
            <Route path="/admin/analytics" element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
            <Route path="/admin/settings" element={<AdminRoute><Settings /></AdminRoute>} />
            <Route path="/admin/contacts" element={<AdminRoute><AdminContacts /></AdminRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
