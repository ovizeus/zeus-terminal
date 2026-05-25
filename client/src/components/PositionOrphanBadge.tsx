export function PositionOrphanBadge() {
  return (
    <span
      className="zr-orphan-badge"
      title="ORPHAN: exchange has this position but server doesn't track it. Check manually."
      style={{ color: '#ff4444', fontWeight: 'bold', marginLeft: 4, cursor: 'help' }}
    >
      &#x26A0;
    </span>
  )
}
