import React from 'react';
import Modal from './Modal.jsx';

export default function ConfirmModal({ title, message, onConfirm, onCancel, confirmLabel = 'Delete', danger = true }) {
  return (
    <Modal title={title || 'Confirm'} onClose={onCancel} width={420}>
      <div style={{ fontSize: 14, color: 'var(--ink-2)', marginBottom: 20, lineHeight: 1.5 }}>
        {message}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className={danger ? 'btn-danger' : 'btn-primary'}
          onClick={() => { onConfirm?.(); onCancel(); }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
