import React, { useState, useEffect } from 'react';
import AdminShell from '../../components/AdminShell.jsx';
import { api } from '../../lib/api.js';
import { formatNumber } from '../../lib/format.js';

const MOCK_INVOICES = [
  { id: 'INV-2026-06', period: 'Jun 2026', amount: '₹1,800.00', status: 'Current', messages: 10000 },
  { id: 'INV-2026-05', period: 'May 2026', amount: '₹2,340.00', status: 'Paid', messages: 13000 },
  { id: 'INV-2026-04', period: 'Apr 2026', amount: '₹1,620.00', status: 'Paid', messages: 9000 },
  { id: 'INV-2026-03', period: 'Mar 2026', amount: '₹2,160.00', status: 'Paid', messages: 12000 },
];

export default function Billing() {
  const [stats, setStats] = useState(null);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    api.get('/stats').then(setStats).catch(() => {});
    api.get('/settings').then(setSettings).catch(() => {});
  }, []);

  const sentThisCycle = stats?.sent_7d || 0;
  const costThisCycle = (sentThisCycle * 0.18).toFixed(2);

  return (
    <AdminShell crumbs={['Billing']}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Billing</div>
          <h1>Billing</h1>
          <div className="page-sub">Usage, plan, and invoice history for your SRMC account.</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Plan card */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Current Plan</div>
          <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink-1)', marginBottom: 4 }}>Business</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 16 }}>
            ₹0.18 per message · Unlimited agents · All gateways
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="pill ok"><span className="dot" />Active</span>
            <span style={{ fontSize: 12, color: 'var(--ink-3)', padding: '3px 8px' }}>Renews 1 Jul 2026</span>
          </div>
        </div>

        {/* This cycle */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>This Cycle (7d estimate)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Messages sent</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{formatNumber(sentThisCycle)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Estimated bill</div>
              <div className="num" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>₹{parseFloat(costThisCycle).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
            </div>
          </div>
          <div style={{ marginTop: 12, height: 4, background: 'var(--bg-soft)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, (sentThisCycle / (parseInt(settings.daily_cap) * 30 || 300000)) * 100)}%`, background: 'var(--brand-1)', borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
            Cap: {formatNumber(parseInt(settings.daily_cap || 10000))} msgs/day
          </div>
        </div>
      </div>

      {/* Invoices */}
      <div className="card">
        <div className="card-head">
          <h3>Invoice History</h3>
        </div>
        <table>
          <thead>
            <tr>
              <th>Invoice ID</th>
              <th>Period</th>
              <th>Messages</th>
              <th>Amount</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {MOCK_INVOICES.map(inv => (
              <tr key={inv.id}>
                <td className="num" style={{ fontSize: 12 }}>{inv.id}</td>
                <td style={{ fontSize: 13 }}>{inv.period}</td>
                <td className="num">{formatNumber(inv.messages)}</td>
                <td className="num" style={{ fontWeight: 600 }}>{inv.amount}</td>
                <td>
                  <span className={`pill ${inv.status === 'Paid' ? 'ok' : inv.status === 'Current' ? 'info' : 'idle'}`}>
                    <span className="dot" />
                    {inv.status}
                  </span>
                </td>
                <td>
                  <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}>Download</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
