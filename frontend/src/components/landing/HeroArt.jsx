// Decorative glowing ribbon: stacked rotated ellipses + a gold orbit ring (pure SVG, no assets).
const ribbons = Array.from({ length: 26 }, (_, i) => i)

function HeroArt() {
  return (
    <svg className="hero-art" viewBox="0 0 520 420" role="presentation" aria-hidden="true">
      <defs>
        <linearGradient id="rib" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4b50" />
          <stop offset="1" stopColor="#DC0208" />
        </linearGradient>
        <radialGradient id="floor" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#DC0208" stopOpacity="0.55" />
          <stop offset="1" stopColor="#DC0208" stopOpacity="0" />
        </radialGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse cx="260" cy="385" rx="190" ry="22" fill="url(#floor)" />
      <g className="hero-art__ribbon" filter="url(#glow)" fill="none" stroke="url(#rib)">
        {ribbons.map((i) => (
          <ellipse
            key={i}
            cx="260"
            cy="205"
            rx={185 - i * 3.2}
            ry={48 + i * 2.6}
            strokeWidth={i % 5 === 0 ? 1.6 : 0.7}
            strokeOpacity={0.35 + (i % 6) * 0.1}
            transform={`rotate(${-75 + i * 6.2} 260 205)`}
          />
        ))}
      </g>
      <ellipse className="hero-art__orbit" cx="260" cy="215" rx="245" ry="62" fill="none" stroke="#FFEF93" strokeWidth="1.6" transform="rotate(-9 260 215)" filter="url(#glow)" />
      <g fill="none" stroke="#FFEF93" strokeWidth="1.2" opacity="0.9">
        <rect x="402" y="92" width="9" height="9" transform="rotate(45 406 96)" />
        <rect x="118" y="168" width="7" height="7" transform="rotate(45 121 171)" />
        <rect x="448" y="330" width="11" height="11" transform="rotate(45 453 335)" />
      </g>
    </svg>
  )
}

export default HeroArt
