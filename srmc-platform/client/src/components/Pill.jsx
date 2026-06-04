import React from 'react';

const STATUS_MAP = {
  online:    'ok',
  sent:      'ok',
  done:      'ok',
  active:    'ok',
  confirmed: 'ok',
  slow:      'warn',
  sending:   'warn',
  scheduled: 'warn',
  'needs-reply': 'warn',
  offline:   'err',
  failed:    'err',
  cancelled: 'err',
  'opt-out': 'err',
  unknown:   'idle',
  pending:   'idle',
  idle:      'idle',
  paused:    'idle',
  info:      'info',
};

export default function Pill({ status, label, className = '' }) {
  const cls = STATUS_MAP[status] || STATUS_MAP[label] || 'idle';
  const text = label || status || '';
  return (
    <span className={`pill ${cls} ${className}`}>
      <span className="dot" />
      {text}
    </span>
  );
}
