import React from 'react';

export default function LiveBadge({ label = 'Live' }) {
  return (
    <span className="live-badge">
      <span className="live-dot" />
      {label}
    </span>
  );
}
