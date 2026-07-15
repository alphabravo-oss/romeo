/**
 * At-a-glance stat cards for a panel header. Values must be derived from REAL
 * query data (e.g. `data.length`, `data.filter(...).length`) — never hardcoded.
 *
 *   <PanelStats items={[
 *     { label: 'Keys', value: keys.length },
 *     { label: 'Revoked', value: keys.filter((k) => k.revokedAt).length },
 *   ]} />
 *
 * Emits the existing `.rm-stat-grid` / `.rm-stat` design-system markup.
 */
export function PanelStats(props: {
  items: { label: string; value: React.ReactNode }[]
}): React.ReactNode {
  if (props.items.length === 0) return null
  return (
    <div className="rm-stat-grid">
      {props.items.map((item) => (
        <div className="rm-stat" key={item.label}>
          <div className="rm-stat-label">{item.label}</div>
          <div className="rm-stat-value">{item.value}</div>
        </div>
      ))}
    </div>
  )
}
