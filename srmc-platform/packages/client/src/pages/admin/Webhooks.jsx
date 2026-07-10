import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

export default function Webhooks() {
  const [settings, setSettings] = useState({});
  const [activities, setActivities] = useState([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/settings').then(setSettings).catch(() => {});
    api.get('/activity?limit=20').then(d => {
      setActivities((d.activities || []).filter(a => a.action.includes('webhook') || a.action === 'inbound:new'));
    }).catch(() => {});
  }, []);

  const webhookUrl = `${window.location.protocol}//${window.location.hostname}:3001/api/webhook/inbound`;

  function handleCopy() {
    navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return formatDate(iso);
  }

  return (
    <AdminShell>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <img src="/assets/SRMC_LOGO.jpg" alt="SystemBlast" style={{ width: 36, height: 36, flexShrink: 0 }} />
          <div>
            <div className="eyebrow">People & Devices</div>
            <h1>Webhooks</h1>
            <div className="page-sub">Inbound webhook endpoint for receiving messages from Android gateways.</div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 16 }}>
        {/* Webhook URL */}
        <div className="card">
          <div className="card-head">
            <h3>Inbound Webhook URL</h3>
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>
              Configure your FlashSMSGateway Android app to POST inbound messages to this URL. No authentication is required.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="input mono" style={{ flex: 1, fontSize: 12, padding: '10px 12px', background: 'var(--bg-soft)', cursor: 'text', userSelect: 'all' }}>
                {webhookUrl}
              </div>
              <button className="btn-ghost" onClick={handleCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-soft)', borderRadius: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 8 }}>Expected payload</div>
              <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-2)', lineHeight: 1.6, margin: 0 }}>
{`POST /api/webhook/inbound
Content-Type: application/json

{
  "from": "+919700942849",
  "body": "STOP",
  "gateway_id": "optional-gateway-ref"
}`}
              </pre>
            </div>
          </div>
        </div>

        {/* Auto-detection rules */}
        <div className="card">
          <div className="card-head">
            <h3>Auto-detection Rules</h3>
          </div>
          <div style={{ padding: 18 }}>
            <table>
              <thead>
                <tr>
                  <th>Pattern</th>
                  <th>Detected Flag</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="num" style={{ fontSize: 12 }}>STOP (exact)</td>
                  <td><span className="pill err"><span className="dot" />opt-out</span></td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>Recipient opts out of future messages</td>
                </tr>
                <tr>
                  <td className="num" style={{ fontSize: 12 }}>YES...</td>
                  <td><span className="pill ok"><span className="dot" />confirmed</span></td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>Recipient confirms receipt or agreement</td>
                </tr>
                <tr>
                  <td className="num" style={{ fontSize: 12 }}>Everything else</td>
                  <td><span className="pill warn"><span className="dot" />needs-reply</span></td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>Message requires a manual reply</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* API Secret */}
        <div className="card">
          <div className="card-head">
            <h3>API Secret</h3>
          </div>
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 10 }}>
              Use this secret when integrating external systems. The inbound webhook does not require authentication.
            </div>
            <div className="input mono" style={{ fontSize: 12, padding: '10px 12px', background: 'var(--bg-soft)', cursor: 'text', userSelect: 'all' }}>
              {settings.webhook_secret || '—'}
            </div>
          </div>
        </div>

        {/* Recent webhook activity */}
        <div className="card">
          <div className="card-head">
            <h3>Recent Webhook Activity</h3>
          </div>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Action</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {activities.length === 0 && (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--ink-3)', padding: '16px 18px' }}>No webhook activity yet.</td></tr>
              )}
              {activities.map((a, i) => (
                <tr key={a.id || i}>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{formatTime(a.created_at)}</td>
                  <td style={{ fontSize: 12, fontWeight: 500 }}>{a.action}</td>
                  <td style={{ fontSize: 12, color: 'var(--ink-3)' }}>{a.detail || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
