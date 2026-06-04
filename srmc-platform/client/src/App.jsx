import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';

import Login from './pages/Login.jsx';
import BlastDashboard from './pages/agent/BlastDashboard.jsx';
import History from './pages/agent/History.jsx';
import AgentTemplates from './pages/agent/Templates.jsx';
import Inbound from './pages/agent/Inbound.jsx';
import Gateway from './pages/agent/Gateway.jsx';

import AdminDashboard from './pages/admin/Dashboard.jsx';
import Campaigns from './pages/admin/Campaigns.jsx';
import AdminTemplates from './pages/admin/Templates.jsx';
import AdminInbound from './pages/admin/Inbound.jsx';
import Agents from './pages/admin/Agents.jsx';
import Numbers from './pages/admin/Numbers.jsx';
import Webhooks from './pages/admin/Webhooks.jsx';
import Activity from './pages/admin/Activity.jsx';
import AdminAnalytics from './pages/admin/Analytics.jsx';
import Billing from './pages/admin/Billing.jsx';
import Settings from './pages/admin/Settings.jsx';

function RoleRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  return <Navigate to="/compose" replace />;
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
  if (user.role !== 'admin') return <Navigate to="/compose" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<ProtectedRoute><RoleRedirect /></ProtectedRoute>} />
          <Route path="/compose" element={<ProtectedRoute><BlastDashboard /></ProtectedRoute>} />
          <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
          <Route path="/templates" element={<ProtectedRoute><AgentTemplates /></ProtectedRoute>} />
          <Route path="/inbound" element={<ProtectedRoute><Inbound /></ProtectedRoute>} />
          <Route path="/gateway" element={<ProtectedRoute><Gateway /></ProtectedRoute>} />
          <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/campaigns" element={<AdminRoute><Campaigns /></AdminRoute>} />
          <Route path="/admin/templates" element={<AdminRoute><AdminTemplates /></AdminRoute>} />
          <Route path="/admin/inbound" element={<AdminRoute><AdminInbound /></AdminRoute>} />
          <Route path="/admin/agents" element={<AdminRoute><Agents /></AdminRoute>} />
          <Route path="/admin/numbers" element={<AdminRoute><Numbers /></AdminRoute>} />
          <Route path="/admin/webhooks" element={<AdminRoute><Webhooks /></AdminRoute>} />
          <Route path="/admin/activity" element={<AdminRoute><Activity /></AdminRoute>} />
          <Route path="/admin/analytics" element={<AdminRoute><AdminAnalytics /></AdminRoute>} />
          <Route path="/admin/billing" element={<AdminRoute><Billing /></AdminRoute>} />
          <Route path="/admin/settings" element={<AdminRoute><Settings /></AdminRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
