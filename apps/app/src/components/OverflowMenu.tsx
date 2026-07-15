import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.mjs'
import { useEffect, useRef, useState } from 'react'

export interface OverflowMenuItem {
  label: string
  onClick: () => void
  tone?: 'default' | 'danger'
  disabled?: boolean
}

/**
 * A "⋯" button that reveals a dropdown of secondary/tertiary row actions —
 * keeps dense rows to one primary action plus this menu. Closes on outside
 * click, Escape, or after an item runs.
 *
 *   <OverflowMenu items={[
 *     { label: 'Test', onClick: () => test(row.id) },
 *     { label: 'Disable', onClick: () => disable(row.id), tone: 'danger' },
 *   ]} />
 */
export function OverflowMenu(props: { items: OverflowMenuItem[]; label?: string }): React.ReactNode {
  const { items, label = 'More actions' } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocMouseDown(event: MouseEvent) {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <div className="rm-overflow" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="rm-icon-button"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className="rm-overflow-menu" role="menu">
          {items.map((item) => (
            <button
              className={`rm-overflow-item${item.tone === 'danger' ? ' danger' : ''}`}
              disabled={item.disabled}
              key={item.label}
              onClick={() => {
                setOpen(false)
                item.onClick()
              }}
              role="menuitem"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
