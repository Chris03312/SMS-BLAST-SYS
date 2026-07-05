import React from 'react';

export default function Skeleton({ variant = 'text', width, height, count = 1, style }) {
  const base = {
    background: 'var(--bg-soft)',
    borderRadius: 6,
    animation: 'skeletonShimmer 1.5s ease-in-out infinite',
    backgroundImage: 'linear-gradient(90deg, var(--bg-soft) 25%, var(--bg-card) 50%, var(--bg-soft) 75%)',
    backgroundSize: '200% 100%',
  };

  const variants = {
    text:      { height: 12, width: '60%' },
    title:     { height: 22, width: '40%' },
    avatar:    { height: 28, width: 28, borderRadius: 6 },
    card:      { height: 80, width: '100%', borderRadius: 10 },
    chart:     { height: 180, width: '100%', borderRadius: 10 },
    row:       { height: 44, width: '100%' },
    badge:     { height: 22, width: 60, borderRadius: 999 },
    button:    { height: 34, width: 100, borderRadius: 7 },
  };

  const merged = { ...base, ...variants[variant] || variants.text, ...style };
  if (width) merged.width = width;
  if (height) merged.height = height;

  if (count > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={merged} />
        ))}
      </div>
    );
  }

  return <div style={merged} />;
}

/** Skeleton table row — renders a full-width row with configurable columns */
export function SkeletonRow({ cols = 5, avatar = false }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} style={{ padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {i === 0 && avatar && <Skeleton variant="avatar" />}
            <Skeleton variant="text" width={i === 0 ? '70%' : i === cols - 1 ? '30%' : '50%'} />
          </div>
        </td>
      ))}
    </tr>
  );
}

/** Skeleton stats card grid */
export function SkeletonStats({ count = 4 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(count, 4)}, 1fr)`, gap: 12 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: '16px 18px' }}>
          <Skeleton variant="text" width="50%" style={{ marginBottom: 8 }} />
          <Skeleton variant="title" width="60%" />
        </div>
      ))}
    </div>
  );
}

/** Skeleton conversation bubble loading state */
export function SkeletonConv() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} style={{
          display: 'flex', gap: 8,
          justifyContent: i % 2 === 0 ? 'flex-start' : 'flex-end',
        }}>
          <div style={{
            width: '70%', padding: 12, borderRadius: 12,
            background: 'var(--bg-soft)',
          }}>
            <Skeleton variant="text" width="90%" />
            <Skeleton variant="text" width="50%" style={{ marginTop: 6 }} />
          </div>
        </div>
      ))}
    </div>
  );
}
