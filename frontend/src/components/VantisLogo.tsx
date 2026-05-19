interface Props {
  size?: number
  animated?: boolean
  className?: string
}

export default function VantisLogo({ size = 48, animated = true, className = '' }: Props) {
  const r = size / 2
  const cx = r
  const cy = r

  // Globe latitude/longitude arcs
  const latitudes = [-0.6, -0.3, 0, 0.3, 0.6]
  const longitudes = [0, 0.25, 0.5, 0.75]

  function ellipsePoints(latFrac: number, segments = 64): string {
    const ry = r * 0.45 * Math.sqrt(1 - latFrac * latFrac)
    const y = cy + latFrac * r * 0.9
    const points = []
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * 2 * Math.PI
      points.push(`${cx + Math.cos(angle) * r * 0.9},${y + Math.sin(angle) * ry * 0.35}`)
    }
    return points.join(' ')
  }

  function meridianPoints(longFrac: number, segments = 64): string {
    const points = []
    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * Math.PI * 2
      const x = cx + Math.cos(t + longFrac * Math.PI * 2) * r * 0.9 * 0.5
      const y = cy + Math.sin(t) * r * 0.88
      points.push(`${x},${y}`)
    }
    return points.join(' ')
  }

  // Connection nodes on the globe surface
  const nodes = [
    { x: cx - r * 0.4, y: cy - r * 0.3 },
    { x: cx + r * 0.5, y: cy - r * 0.2 },
    { x: cx + r * 0.2, y: cy + r * 0.4 },
    { x: cx - r * 0.5, y: cy + r * 0.2 },
    { x: cx,           y: cy - r * 0.6 },
    { x: cx + r * 0.4, y: cy + r * 0.1 },
    { x: cx - r * 0.1, y: cy + r * 0.5 },
    { x: cx - r * 0.6, y: cy - r * 0.1 },
  ]

  // Data pixel streams feeding into the globe from outside
  const streams = [
    { x1: cx - r, y1: cy - r, x2: cx - r * 0.55, y2: cy - r * 0.25 },
    { x1: cx + r, y1: cy - r * 0.7, x2: cx + r * 0.55, y2: cy - r * 0.15 },
    { x1: cx + r * 0.8, y1: cy + r, x2: cx + r * 0.3, y2: cy + r * 0.45 },
    { x1: cx - r * 0.9, y1: cy + r * 0.8, x2: cx - r * 0.45, y2: cy + r * 0.25 },
  ]

  const id = `vantis-logo-${size}`

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={`${id}-grd`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </radialGradient>
        <filter id={`${id}-glow`}>
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {animated && (
          <style>{`
            @keyframes vantis-pulse-${size} {
              0%, 100% { opacity: 0.6; r: 1.5px; }
              50% { opacity: 1; r: 2.5px; }
            }
            @keyframes vantis-stream-${size} {
              0% { stroke-dashoffset: 30; opacity: 0; }
              30% { opacity: 1; }
              100% { stroke-dashoffset: 0; opacity: 0.8; }
            }
            .vl-node-${size} { animation: vantis-pulse-${size} 2.5s ease-in-out infinite; }
            .vl-stream-${size} { animation: vantis-stream-${size} 3s ease-in-out infinite; }
            .vl-stream-${size}:nth-child(2) { animation-delay: 0.75s; }
            .vl-stream-${size}:nth-child(3) { animation-delay: 1.5s; }
            .vl-stream-${size}:nth-child(4) { animation-delay: 2.25s; }
          `}</style>
        )}
      </defs>

      {/* Outer circle clip */}
      <clipPath id={`${id}-clip`}>
        <circle cx={cx} cy={cy} r={r * 0.95} />
      </clipPath>

      {/* Globe background glow */}
      <circle cx={cx} cy={cy} r={r * 0.92} fill={`url(#${id}-grd)`} />

      {/* Globe outline */}
      <circle
        cx={cx} cy={cy} r={r * 0.9}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="0.8"
        strokeOpacity="0.5"
        filter={`url(#${id}-glow)`}
      />

      {/* Latitude lines */}
      {latitudes.map((lat, i) => (
        <polyline
          key={`lat-${i}`}
          points={ellipsePoints(lat)}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="0.5"
          strokeOpacity="0.25"
          clipPath={`url(#${id}-clip)`}
        />
      ))}

      {/* Longitude meridians */}
      {longitudes.map((lon, i) => (
        <polyline
          key={`lon-${i}`}
          points={meridianPoints(lon)}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="0.5"
          strokeOpacity="0.2"
          clipPath={`url(#${id}-clip)`}
        />
      ))}

      {/* Internal connection lines between nodes */}
      {nodes.map((a, i) =>
        nodes.slice(i + 1, i + 3).map((b, j) => (
          <line
            key={`conn-${i}-${j}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="#f59e0b"
            strokeWidth="0.5"
            strokeOpacity="0.3"
            clipPath={`url(#${id}-clip)`}
          />
        ))
      )}

      {/* Data stream lines feeding in from outside */}
      {streams.map((s, i) => (
        <line
          key={`stream-${i}`}
          className={animated ? `vl-stream-${size}` : ''}
          x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke="#f59e0b"
          strokeWidth="0.8"
          strokeOpacity={animated ? 0 : 0.5}
          strokeDasharray="4 3"
        />
      ))}

      {/* Pixel data dots at stream tips */}
      {streams.map((s, i) => [
        { x: s.x1, y: s.y1, size: 1 },
        { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2, size: 0.8 },
      ].map((dot, j) => (
        <rect
          key={`px-${i}-${j}`}
          x={dot.x - dot.size / 2}
          y={dot.y - dot.size / 2}
          width={dot.size}
          height={dot.size}
          fill="#f59e0b"
          fillOpacity="0.6"
        />
      )))}

      {/* Connection nodes on globe */}
      {nodes.map((n, i) => (
        <circle
          key={`node-${i}`}
          className={animated ? `vl-node-${size}` : ''}
          cx={n.x} cy={n.y}
          r="1.8"
          fill="#f59e0b"
          fillOpacity="0.8"
          filter={`url(#${id}-glow)`}
          clipPath={`url(#${id}-clip)`}
          style={animated ? { animationDelay: `${i * 0.3}s` } : {}}
        />
      ))}

      {/* Center node */}
      <circle
        cx={cx} cy={cy} r="2.5"
        fill="#f59e0b"
        fillOpacity="0.9"
        filter={`url(#${id}-glow)`}
      />
    </svg>
  )
}
