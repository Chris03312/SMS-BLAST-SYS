import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import PasswordInput from '../components/PasswordInput.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(username, password);
      navigate(user.role === 'admin' ? '/admin' : '/compose');
    } catch (err) {
      setError(err.message || 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <div className="brand">
        <div className="grid-overlay" />
        <div className="orb" />
        <div className="brand-inner">
          <img src="/assets/SRMC_LOGO.jpg" alt="SMS Platform" className="brand-logo" style={{ width: 80, marginBottom: 32 }} />
          <div className="eyebrow">SMS Broadcast Platform</div>
          <h1>
            Broadcast.<br />
            <span className="grad-text">At scale.</span>
          </h1>
          <p className="brand-copy">
            Send bulk SMS via Android gateways. Real-time delivery tracking, and multi-agent support.
          </p>
          <div className="stat-row">
            <div>
              <div className="stat-n">10k+</div>
              <div className="stat-l">Daily sends</div>
            </div>
            <div>
              <div className="stat-n">99.1%</div>
              <div className="stat-l">Delivery rate</div>
            </div>
            <div>
              <div className="stat-n">6s</div>
              <div className="stat-l">Default delay</div>
            </div>
          </div>
          <div className="spacer" />
          <div className="brand-footer">
            <span>© 2026 SMS Platform</span>
            <span>v1.0.0</span>
          </div>
        </div>
      </div>
      <div className="form-panel">
        <div className="form-inner">
          <div className="form-eyebrow">Secure Portal</div>
          <div className="form-title">Sign in</div>
          <div className="form-sub">Enter your credentials to access the broadcast console.</div>
          <form className="form-stack" onSubmit={handleSubmit}>
            <div className="field">
              <div className="field-head">
                <span>Username</span>
              </div>
              <input
                className="input"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="field">
              <div className="field-head">
                <span>Password</span>
              </div>
              <PasswordInput
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            {error && (
              <div style={{
                padding: '10px 14px',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 8,
                color: '#DC2626',
                fontSize: 13,
              }}>
                {error}
              </div>
            )}
            <button className="cta" type="submit" disabled={loading}>
              <span>{loading ? 'Signing in...' : 'Sign in'}</span>
              <span>→</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
