import { useState } from 'react'

export interface TabItem {
  id: string
  label: string
  content: React.ReactNode
}

/**
 * Simple tab strip for dense panels — reveal one section at a time instead of
 * stacking everything vertically. Uncontrolled (tracks its own active tab);
 * defaults to the first tab.
 *
 *   <Tabs tabs={[
 *     { id: 'plan', label: 'Plan', content: <PlanForm /> },
 *     { id: 'quotas', label: 'Quota tiers', content: <QuotaTable /> },
 *   ]} />
 */
export function Tabs(props: { tabs: TabItem[]; initialId?: string }): React.ReactNode {
  const { tabs, initialId } = props
  const [active, setActive] = useState(initialId ?? tabs[0]?.id ?? '')
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0]

  return (
    <div className="rm-tabs">
      <div aria-label="Sections" className="rm-tablist" role="tablist">
        {tabs.map((tab) => (
          <button
            aria-selected={tab.id === current?.id}
            className={`rm-tab${tab.id === current?.id ? ' selected' : ''}`}
            key={tab.id}
            onClick={() => setActive(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="rm-tabpanel" role="tabpanel">
        {current?.content}
      </div>
    </div>
  )
}
