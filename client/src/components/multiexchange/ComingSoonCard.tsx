interface Props {
  label: string
  phase: string
}

export function ComingSoonCard({ label, phase }: Props) {
  return (
    <div
      data-testid={`coming-soon-card-${label.toLowerCase()}`}
      className="multi-exchange-card multi-exchange-card-coming-soon"
      style={{
        background: '#13192a',
        border: '1px dashed #fbbf2466',
        borderRadius: '6px',
        padding: '14px',
        cursor: 'not-allowed',
        opacity: 0.6,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'repeating-linear-gradient(45deg, transparent 0, transparent 8px, #fbbf2408 8px, #fbbf2408 12px)',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: '14px', letterSpacing: '2px', color: '#94a3b8' }}>
            {label}
          </span>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 600, fontSize: '10px', letterSpacing: '1px', color: '#fbbf24' }}>
            ◌ COMING SOON
          </span>
        </div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', color: '#fbbf24cc', lineHeight: '1.6' }}>
          {phase}
        </div>
      </div>
    </div>
  )
}
