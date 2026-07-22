import React, { Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import Login from './pages/Login.jsx';

// ── Code-split page components ──────────────────────────────────────────
// Each page is loaded only when its route is visited, reducing the initial
// bundle from ~1.3 MB to ~200–300 KB.

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

// ── Background page preloader ──────────────────────────────────────────
// After the user logs in, silently download all page JS chunks in the background.
// Since dynamic import() with the same URL returns the cached module, this
// causes React.lazy() to resolve instantly when the user navigates — no skeleton flash.

function PagePreloader() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    // Preload all lazy-loaded pages in the background.
    // These share the same import() calls as the React.lazy() factories above,
    // so the module cache serves them instantly when navigated to.
    const pages = [
      import('./pages/agent/Dashboard.jsx'),
      import('./pages/agent/BlastDashboard.jsx'),
      import('./pages/agent/History.jsx'),
      import('./pages/agent/Templates.jsx'),
      import('./pages/agent/Inbound.jsx'),
      import('./pages/agent/Gateway.jsx'),
      import('./pages/agent/Recipients.jsx'),
      import('./pages/admin/Dashboard.jsx'),
      import('./pages/admin/Campaigns.jsx'),
      import('./pages/admin/Templates.jsx'),
      import('./pages/admin/Inbound.jsx'),
      import('./pages/admin/AdminAgents.jsx'),
      import('./pages/admin/Agents.jsx'),
      import('./pages/admin/Numbers.jsx'),
      import('./pages/admin/Webhooks.jsx'),
      import('./pages/admin/Activity.jsx'),
      import('./pages/admin/Analytics.jsx'),
      import('./pages/admin/Contacts.jsx'),
      import('./pages/admin/Settings.jsx'),
    ];
    Promise.allSettled(pages).catch(() => {});
  }, [user]);

  return null;
}

// ── Route guards ───────────────────────────────────────────────────────

function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin' || user.role === 'super_admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/dashboard" replace />;
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin' && user.role !== 'super_admin') return <Navigate to="/compose" replace />;
  return children;
}

function AgentRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin' || user.role === 'super_admin') return <Navigate to="/admin" replace />;
  return children;
}

// ── App ────────────────────────────────────────────────────────────────

// ── Splash manager ────────────────────────────────────────────────────
// Keeps the HTML splash screen visible until auth check completes.
// This prevents a blank flash between JS executing and content rendering.

function SplashManager() {
  const { loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      const el = document.getElementById('splash');
      if (el) {
        el.classList.add('hide');
        setTimeout(() => el.remove(), 350);
      }
    }
  }, [loading]);

  return null;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
      <SplashManager />
      <PagePreloader />
      <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={null}>
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
    </ThemeProvider>
  );
}
