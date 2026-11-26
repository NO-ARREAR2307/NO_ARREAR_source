/** Reusable shimmering placeholders. They are decorative: the wrapping region announces loading to screen readers. */
export function Skeleton({ width, height = '1rem', radius, className = '', style }) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  )
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`skeleton-text ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height="0.85rem" width={i === lines - 1 && lines > 1 ? '60%' : '100%'} />
      ))}
    </div>
  )
}

/** Placeholder for a dashboard stat card (icon tile, label, value). */
export function StatCardSkeleton() {
  return (
    <div className="card skeleton-card" role="status" aria-busy="true" aria-live="polite">
      <Skeleton width="42px" height="42px" radius="var(--radius-md)" className="skeleton--mb" />
      <Skeleton width="45%" height="0.7rem" className="skeleton--mb-sm" />
      <Skeleton width="75%" height="1.5rem" />
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/** Placeholder for a label/value list (profile details, academic information). */
export function DetailsSkeleton({ rows = 4, columns = true }) {
  return (
    <div className={`details ${columns ? 'details--row' : ''}`} role="status" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i}>
          <Skeleton width="40%" height="0.65rem" className="skeleton--mb-sm" />
          <Skeleton width={i % 2 ? '70%' : '85%'} height="1.05rem" />
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

/** Placeholder for the sidebar's academic summary chips. */
export function ChipSkeleton() {
  return <Skeleton width="3.2rem" height="1.2rem" radius="var(--radius-full)" />
}
