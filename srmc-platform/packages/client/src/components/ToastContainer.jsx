import React from 'react';
import { useToast } from '../context/ToastContext.jsx';

const TYPE_STYLES = {
  success: {
    bg: 'var(--ok-bg)',
    border: '1px solid var(--ok-line)',
    color: 'var(--ok)',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  error: {
    bg: 'var(--err-bg)',
    border: '1px solid var(--err-line)',
    color: 'var(--err)',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    ),
  },
  warning: {
    bg: 'var(--warn-bg)',
    border: '1px solid var(--warn-line)',
    color: 'var(--warn)',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  info: {
    bg: 'var(--info-bg)',
    border: '1px solid var(--info-line)',
    color: 'var(--info)',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    ),
  },
};

export default function ToastContainer({ topOffset = 20, rightOffset = 28 }) {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: topOffset,
        right: rightOffset,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map(t => {
        const s = TYPE_STYLES[t.type] || TYPE_STYLES.info;
        return (
          <div
            key={t.id}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '12px 14px',
              background: 'var(--bg-card)',
              border: s.border,
              borderRadius: 10,
              boxShadow: 'var(--shadow-lg)',
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--ink-1)',
              minWidth: 280,
              maxWidth: 420,
              opacity: t.leaving ? 0 : 1,
              transform: t.leaving ? 'translateX(30px)' : 'translateX(0)',
              transition: 'opacity 0.2s ease, transform 0.2s ease',
              animation: !t.leaving ? 'toastSlideIn 0.25s ease-out' : 'none',
            }}
            role="alert"
          >
            <span
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: s.bg,
                color: s.color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {s.icon}
            </span>
            <span style={{ flex: 1, lineHeight: 1.4 }}>{t.message}</span>
            <button
              onClick={() => removeToast(t.id)}
              aria-label="Dismiss"
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--ink-4)',
                fontSize: 18,
                lineHeight: 1,
                padding: '0 2px',
                flexShrink: 0,
                borderRadius: 4,
                transition: 'color 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.color = 'var(--ink-1)'}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--ink-4)'}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
